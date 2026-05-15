package api

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-manager/internal/docker"
)

type dockerHandler struct {
	manager  *docker.Manager
	database *sql.DB
}

func (h *dockerHandler) startProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Start(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) stopProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Stop(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deployStream keeps SSE for backwards compatibility.
func (h *dockerHandler) deployStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	send := func(evt docker.DeployEvent) {
		b, _ := json.Marshal(evt)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	h.manager.DeployStream(r.Context(), name, send) //nolint:errcheck
}

// stopStream keeps SSE for backwards compatibility.
func (h *dockerHandler) stopStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	send := func(evt docker.DeployEvent) {
		b, _ := json.Marshal(evt)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	pr, pw := newSSEPipe()
	var stopErr error
	go func() {
		defer pw.Close()
		stopErr = h.manager.StopStream(r.Context(), name, pw)
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
		}
		send(docker.DeployEvent{Type: docker.DeployEventCompose, Line: scanner.Text()})
	}

	evt := docker.DeployEvent{Type: docker.DeployEventDone, Success: stopErr == nil}
	if stopErr != nil {
		evt.Error = stopErr.Error()
	}
	send(evt)
}

func (h *dockerHandler) logsStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if names := h.manager.GetContainerNames(r.Context(), name); len(names) > 0 {
		b, _ := json.Marshal(names)
		fmt.Fprintf(w, "event: services\ndata: %s\n\n", b)
		flusher.Flush()
	}

	pr, pw := newSSEPipe()
	defer pw.Close()

	go func() {
		defer pw.Close()
		h.manager.StreamLogs(r.Context(), name, pw, docker.LogStreamOptions{Follow: true, Tail: "200"}) //nolint:errcheck
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
		}
		fmt.Fprintf(w, "data: %s\n\n", scanner.Bytes())
		flusher.Flush()
	}
}

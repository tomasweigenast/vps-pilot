package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/tomasweigenast/vps-manager/internal/docker"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

// wsMetrics upgrades to WebSocket and subscribes the client to the metrics hub.
func (h *systemHandler) wsMetrics(w http.ResponseWriter, r *http.Request) {
	h.wsHub.Upgrade(w, r)
}

// wsProjectLogs upgrades to WebSocket and streams container logs for a project.
func (h *dockerHandler) wsProjectLogs(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Container names event
	if names := h.manager.GetContainerNames(r.Context(), name); len(names) > 0 {
		b, _ := json.Marshal(wslib.Event{Type: "services", Data: names})
		conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
	}

	pr, pw := newSSEPipe()
	defer pw.Close()

	go func() {
		defer pw.Close()
		h.manager.StreamLogs(r.Context(), name, pw)
	}()

	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
		}
		b, _ := json.Marshal(wslib.Event{Type: "log", Data: scanner.Text()})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}
}

// wsDeployStream upgrades to WebSocket and streams deploy events.
func (h *dockerHandler) wsDeployStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	send := func(evt docker.DeployEvent) {
		b, _ := json.Marshal(wslib.Event{Type: string(evt.Type), Data: evt})
		conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
	}

	h.manager.DeployStream(r.Context(), name, send) //nolint:errcheck
}

// wsStopStream upgrades to WebSocket and streams stop events.
func (h *dockerHandler) wsStopStream(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

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
		b, _ := json.Marshal(wslib.Event{Type: "compose", Data: scanner.Text()})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}

	evt := docker.DeployEvent{Type: docker.DeployEventDone, Success: stopErr == nil}
	if stopErr != nil {
		evt.Error = stopErr.Error()
	}
	b, _ := json.Marshal(wslib.Event{Type: string(evt.Type), Data: evt})
	conn.WriteMessage(websocket.TextMessage, b) //nolint:errcheck
}

// wsServerLogs upgrades to WebSocket and streams server log lines.
func (h *logsHandler) wsServerLogs(w http.ResponseWriter, r *http.Request) {
	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	for _, line := range h.buf.Lines(100) {
		b, _ := json.Marshal(wslib.Event{Type: "log", Data: fmt.Sprintf("%s", line)})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}

	ch := h.buf.Subscribe()
	defer h.buf.Unsubscribe(ch)

	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(wslib.Event{Type: "log", Data: fmt.Sprintf("%s", line)})
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}

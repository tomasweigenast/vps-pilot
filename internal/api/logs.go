package api

import (
	"bufio"
	"database/sql"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"

	"github.com/tomasweigenast/vps-manager/internal/db"
	"github.com/tomasweigenast/vps-manager/internal/logbuffer"
)

type logsHandler struct {
	buf      *logbuffer.RingBuffer
	database *sql.DB
	logSink  string
}

// serverLogsStream keeps SSE for backwards compatibility.
func (h *logsHandler) serverLogsStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	for _, line := range h.buf.Lines(100) {
		fmt.Fprintf(w, "data: %s\n\n", line)
	}
	flusher.Flush()

	ch := h.buf.Subscribe()
	defer h.buf.Unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		case <-ctx.Done():
			return
		}
	}
}

// journalctlStream keeps SSE for backwards compatibility.
func (h *logsHandler) journalctlStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	if _, err := exec.LookPath("journalctl"); err != nil {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		fmt.Fprintf(w, "data: journalctl not available on this system\n\n")
		flusher.Flush()
		return
	}

	unit := r.URL.Query().Get("unit")
	priority := r.URL.Query().Get("priority")
	args := []string{"-f", "-n", "100", "--no-pager", "-o", "short-iso"}
	if unit != "" {
		args = append(args, "-u", unit)
	}
	if priority != "" {
		args = append(args, "-p", priority)
	}

	ctx := r.Context()
	cmd := exec.CommandContext(ctx, "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "pipe error", http.StatusInternalServerError)
		return
	}
	cmd.Stderr = cmd.Stdout

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "data: failed to start journalctl: %s\n\n", err)
		flusher.Flush()
		return
	}
	defer cmd.Wait() //nolint:errcheck

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		fmt.Fprintf(w, "data: %s\n\n", scanner.Text())
		flusher.Flush()
	}
}

func (h *logsHandler) logsHistory(w http.ResponseWriter, r *http.Request) {
	if h.logSink != "sqlite" && h.logSink != "both" {
		jsonOK(w, []db.LogEntry{})
		return
	}
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	search := r.URL.Query().Get("search")
	entries, err := db.QueryLogs(h.database, limit, search)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "query logs")
		return
	}
	jsonOK(w, entries)
}

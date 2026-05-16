package api

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"net/http"
	"os/exec"
	"strconv"

	"github.com/gorilla/websocket"
	"github.com/tomasweigenast/vps-manager/internal/db"
	"github.com/tomasweigenast/vps-manager/internal/logbuffer"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

type logsHandler struct {
	buf      *logbuffer.RingBuffer
	database *sql.DB
	logSink  string
}

func (h *logsHandler) wsJournalctlStream(w http.ResponseWriter, r *http.Request) {
	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	sendEvent := func(typ, data string) error {
		b, _ := json.Marshal(wslib.Event{Type: typ, Data: data})
		return conn.WriteMessage(websocket.TextMessage, b)
	}

	if _, err := exec.LookPath("journalctl"); err != nil {
		sendEvent("error", "journalctl not available on this system") //nolint:errcheck
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
		sendEvent("error", "pipe error") //nolint:errcheck
		return
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		sendEvent("error", "failed to start journalctl: "+err.Error()) //nolint:errcheck
		return
	}
	defer cmd.Wait() //nolint:errcheck

	// Drain control frames so the browser's CLOSE frame is consumed.
	go func() {
		defer conn.Close()
		conn.SetReadLimit(512)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if err := sendEvent("log", scanner.Text()); err != nil {
			return
		}
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

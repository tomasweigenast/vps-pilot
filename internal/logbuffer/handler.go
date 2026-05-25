package logbuffer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// Sink controls where server logs are persisted beyond the in-memory ring buffer.
type Sink string

const (
	SinkMemory     Sink = "memory"     // ring buffer only (default)
	SinkSQLite     Sink = "sqlite"     // ring buffer + SQLite server_logs table
	SinkJournalctl Sink = "journalctl" // ring buffer + stderr (captured by systemd journal)
	SinkBoth       Sink = "both"       // ring buffer + SQLite + stderr
)

// Handler is a slog.Handler that always writes to a RingBuffer and optionally
// to SQLite or stderr (for systemd journal capture).
type Handler struct {
	buf      *RingBuffer
	db       *sql.DB
	sink     Sink
	levelVar *slog.LevelVar
	inner    slog.Handler // text handler writing to buf (and stderr when needed)
	attrs    []slog.Attr
	group    string
	mu       sync.RWMutex
}

// NewHandler creates a Handler. db may be nil when sink is memory or journalctl.
// levelVar controls the minimum log level and can be changed at runtime via SetLevel.
func NewHandler(buf *RingBuffer, db *sql.DB, sink Sink, levelVar *slog.LevelVar) *Handler {
	h := &Handler{buf: buf, db: db, sink: sink, levelVar: levelVar}
	h.inner = h.buildInner(sink)
	return h
}

func (h *Handler) buildInner(sink Sink) slog.Handler {
	w := io.MultiWriter(h.buf, os.Stdout)
	return slog.NewTextHandler(w, &slog.HandlerOptions{Level: h.levelVar})
}

// SetLevel changes the minimum log level without restarting the handler.
func (h *Handler) SetLevel(level slog.Level) {
	h.levelVar.Set(level)
}

// SetSink changes where logs are persisted (stdout, db, both) without restarting the server.
func (h *Handler) SetSink(sink Sink) {
	h.mu.Lock()
	h.sink = sink
	h.inner = h.buildInner(sink)
	h.mu.Unlock()
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	h.mu.RLock()
	inner := h.inner
	h.mu.RUnlock()
	return inner.Enabled(ctx, level)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	h.mu.RLock()
	inner := h.inner
	sink := h.sink
	h.mu.RUnlock()

	if err := inner.Handle(ctx, r); err != nil {
		return err
	}
	if sink == SinkSQLite || sink == SinkBoth {
		h.persistToSQLite(r)
	}
	return nil
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	h.mu.RLock()
	inner := h.inner
	h.mu.RUnlock()
	return &Handler{
		buf:      h.buf,
		db:       h.db,
		sink:     h.sink,
		levelVar: h.levelVar,
		inner:    inner.WithAttrs(attrs),
		attrs:    append(h.attrs, attrs...),
		group:    h.group,
	}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	h.mu.RLock()
	inner := h.inner
	h.mu.RUnlock()
	return &Handler{
		buf:      h.buf,
		db:       h.db,
		sink:     h.sink,
		levelVar: h.levelVar,
		inner:    inner.WithGroup(name),
		attrs:    h.attrs,
		group:    name,
	}
}

func (h *Handler) persistToSQLite(r slog.Record) {
	if h.db == nil {
		return
	}
	attrs := make(map[string]string, r.NumAttrs())
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = fmt.Sprintf("%v", a.Value.Any())
		return true
	})
	var attrsJSON string
	if len(attrs) > 0 {
		b, _ := json.Marshal(attrs)
		attrsJSON = string(b)
	}
	_, _ = h.db.Exec(
		`INSERT INTO server_logs (level, message, attrs) VALUES (?, ?, ?)`,
		strings.ToLower(r.Level.String()), r.Message, attrsJSON,
	)
}

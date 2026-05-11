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
	buf   *RingBuffer
	db    *sql.DB
	sink  Sink
	inner slog.Handler // text handler writing to buf (and stderr when needed)
	attrs []slog.Attr
	group string
}

// NewHandler creates a Handler. db may be nil when sink is memory or journalctl.
func NewHandler(buf *RingBuffer, db *sql.DB, sink Sink) *Handler {
	var w io.Writer = buf
	if sink == SinkJournalctl || sink == SinkBoth {
		w = io.MultiWriter(buf, os.Stdout)
	}
	inner := slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelDebug})
	return &Handler{buf: buf, db: db, sink: sink, inner: inner}
}

func (h *Handler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *Handler) Handle(ctx context.Context, r slog.Record) error {
	if err := h.inner.Handle(ctx, r); err != nil {
		return err
	}
	if h.sink == SinkSQLite || h.sink == SinkBoth {
		h.persistToSQLite(r)
	}
	return nil
}

func (h *Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &Handler{
		buf:   h.buf,
		db:    h.db,
		sink:  h.sink,
		inner: h.inner.WithAttrs(attrs),
		attrs: append(h.attrs, attrs...),
		group: h.group,
	}
}

func (h *Handler) WithGroup(name string) slog.Handler {
	return &Handler{
		buf:   h.buf,
		db:    h.db,
		sink:  h.sink,
		inner: h.inner.WithGroup(name),
		attrs: h.attrs,
		group: name,
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

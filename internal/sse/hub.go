package sse

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type client struct {
	ch     chan Event
	closed chan struct{}
}

type Hub struct {
	mu      sync.RWMutex
	clients map[*client]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*client]struct{})}
}

func (h *Hub) Broadcast(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.ch <- e:
		default:
		}
	}
}

func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	c := &client{ch: make(chan Event, 16), closed: make(chan struct{})}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	total := len(h.clients)
	h.mu.Unlock()
	slog.Debug("sse client connected", "total", total, "remote", r.RemoteAddr)

	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		remaining := len(h.clients)
		h.mu.Unlock()
		close(c.closed)
		slog.Debug("sse client disconnected", "total", remaining, "remote", r.RemoteAddr)
	}()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case e := <-c.ch:
			data, err := json.Marshal(e)
			if err != nil {
				slog.Error("sse marshal", "err", err)
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

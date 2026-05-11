package sse

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBroadcast_WritesSSELine(t *testing.T) {
	hub := NewHub()

	// Use a real httptest.Server so the response supports http.Flusher
	srv := httptest.NewServer(hub)
	defer srv.Close()

	// Connect an SSE client
	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("expected text/event-stream, got %q", ct)
	}

	// Poll until the hub has a registered client (max 1s)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		hub.mu.RLock()
		n := len(hub.clients)
		hub.mu.RUnlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Broadcast an event
	hub.Broadcast(Event{Type: "test", Data: "hello"})

	// Read one SSE line with a timeout
	done := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data:") {
				done <- line
				return
			}
		}
		done <- ""
	}()

	select {
	case line := <-done:
		if !strings.Contains(line, "test") {
			t.Errorf("expected event type in SSE line, got %q", line)
		}
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for SSE event")
	}
}

func TestHub_ClientCount(t *testing.T) {
	hub := NewHub()

	hub.mu.RLock()
	if len(hub.clients) != 0 {
		t.Errorf("expected 0 clients, got %d", len(hub.clients))
	}
	hub.mu.RUnlock()
}

func TestBroadcast_NoClients(t *testing.T) {
	// Should not panic when no clients connected
	hub := NewHub()
	hub.Broadcast(Event{Type: "test", Data: "hello"})
}

package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // auth handled by requireAuth middleware before upgrade
	},
}

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

type client struct {
	conn   *websocket.Conn
	send   chan []byte
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
	data, err := json.Marshal(e)
	if err != nil {
		slog.Error("ws hub marshal", "err", err)
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- data:
		default:
		}
	}
}

// Upgrade upgrades an HTTP request to a WebSocket connection and registers
// the client in the hub. It blocks until the connection closes.
func (h *Hub) Upgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("ws upgrade", "err", err)
		return
	}

	c := &client{
		conn:   conn,
		send:   make(chan []byte, 32),
		closed: make(chan struct{}),
	}

	h.mu.Lock()
	h.clients[c] = struct{}{}
	total := len(h.clients)
	h.mu.Unlock()
	slog.Debug("ws client connected", "total", total, "remote", r.RemoteAddr)

	go c.writePump()
	c.readPump() // blocks; discards inbound messages

	h.mu.Lock()
	delete(h.clients, c)
	remaining := len(h.clients)
	h.mu.Unlock()
	close(c.closed)
	slog.Debug("ws client disconnected", "total", remaining, "remote", r.RemoteAddr)
}

func (c *client) readPump() {
	defer c.conn.Close()
	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) //nolint:errcheck
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
	}
}

func (c *client) writePump() {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)) //nolint:errcheck
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil) //nolint:errcheck
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)) //nolint:errcheck
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.closed:
			return
		}
	}
}

// Upgrader returns the package-level upgrader for one-off use.
func Upgrader() *websocket.Upgrader { return &upgrader }

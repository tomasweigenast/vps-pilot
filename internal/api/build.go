package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
	wslib "github.com/tomasweigenast/vps-pilot/internal/ws"
)

func randomToken(n int) string {
	b := make([]byte, n)
	rand.Read(b) //nolint:errcheck
	return hex.EncodeToString(b)
}

// buildStore holds in-progress (or recently finished) build event channels,
// keyed by a random build ID.
type buildStore struct {
	mu     sync.Mutex
	builds map[string]chan docker.BuildEvent
}

var globalBuildStore = &buildStore{
	builds: make(map[string]chan docker.BuildEvent),
}

func (bs *buildStore) create(id string) chan docker.BuildEvent {
	ch := make(chan docker.BuildEvent, 512)
	bs.mu.Lock()
	bs.builds[id] = ch
	bs.mu.Unlock()
	return ch
}

func (bs *buildStore) get(id string) (chan docker.BuildEvent, bool) {
	bs.mu.Lock()
	defer bs.mu.Unlock()
	ch, ok := bs.builds[id]
	return ch, ok
}

func (bs *buildStore) remove(id string) {
	bs.mu.Lock()
	delete(bs.builds, id)
	bs.mu.Unlock()
}

// POST /api/images/build
// Body: docker.BuildSpec JSON
// Returns: {"buildId": "..."} immediately, then the client connects to the WS stream.
func (h *dockerHandler) apiBuildImage(w http.ResponseWriter, r *http.Request) {
	var spec docker.BuildSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if spec.DockerfileContent == "" && spec.ContextDir == "" {
		jsonErr(w, http.StatusBadRequest, "dockerfileContent or contextDir required")
		return
	}

	buildID := randomToken(8)
	ch := globalBuildStore.create(buildID)

	// Run the build in the background; close ch when done.
	go func() {
		defer close(ch)
		defer globalBuildStore.remove(buildID)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		if err := h.manager.BuildImage(ctx, spec, ch); err != nil {
			// Error already sent via channel by BuildImage; nothing more to do.
			_ = err
		}
	}()

	jsonOK(w, map[string]string{"buildId": buildID})
}

// GET /api/ws/images/build/{id}
// WebSocket stream of BuildEvent JSON frames.
func (h *dockerHandler) wsBuildStream(w http.ResponseWriter, r *http.Request) {
	buildID := chi.URLParam(r, "id")

	ch, ok := globalBuildStore.get(buildID)
	if !ok {
		http.Error(w, "build not found", http.StatusNotFound)
		return
	}

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Read pump: client disconnect cancels by closing the conn.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for evt := range ch {
		b, _ := json.Marshal(wslib.Event{Type: "build", Data: evt})
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			return
		}
	}
}

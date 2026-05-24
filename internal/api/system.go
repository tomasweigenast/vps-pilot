package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	mobyClient "github.com/moby/moby/client"
	"github.com/tomasweigenast/vps-pilot/internal/metrics"
	wslib "github.com/tomasweigenast/vps-pilot/internal/ws"
)

type systemHandler struct {
	wsHub        *wslib.Hub
	dockerClient *mobyClient.Client
	db           *sql.DB
}

func (h *systemHandler) metricsJSON(w http.ResponseWriter, r *http.Request) {
	snap, err := metrics.Collect(r.Context())
	if err != nil {
		serverErr(w, r, "collect metrics", err)
		return
	}
	jsonOK(w, snap)
}

func (h *systemHandler) sysInfoJSON(w http.ResponseWriter, r *http.Request) {
	info, err := metrics.CollectHostInfo(r.Context(), h.dockerClient)
	if err != nil {
		serverErr(w, r, "collect host info", err)
		return
	}
	jsonOK(w, info)
}

// metricsHistory returns stored metrics snapshots for the requested time range.
// Query param: range = 1h | 6h | 24h | 7d (default 1h)
func (h *systemHandler) metricsHistory(w http.ResponseWriter, r *http.Request) {
	rangeParam := r.URL.Query().Get("range")
	var dur time.Duration
	switch rangeParam {
	case "6h":
		dur = 6 * time.Hour
	case "24h":
		dur = 24 * time.Hour
	case "7d":
		dur = 7 * 24 * time.Hour
	default:
		dur = time.Hour
	}
	from := time.Now().UTC().Add(-dur)
	points, err := metrics.QuerySnapshots(h.db, from)
	if err != nil {
		serverErr(w, r, "query metrics history", err)
		return
	}
	if points == nil {
		points = []metrics.HistoryPoint{}
	}
	jsonOK(w, points)
}

// wsEvents streams Docker daemon events over WebSocket.
// Query params: type (container|image|network|volume|...), action (start|stop|die|...)
func (h *systemHandler) wsEvents(w http.ResponseWriter, r *http.Request) {
	if h.dockerClient == nil {
		jsonErr(w, http.StatusServiceUnavailable, "docker unavailable")
		return
	}

	conn, err := wslib.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Read pump: client close → cancel ctx
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	filters := mobyClient.Filters{}
	if t := r.URL.Query().Get("type"); t != "" {
		filters = filters.Add("type", t)
	}
	if a := r.URL.Query().Get("action"); a != "" {
		filters = filters.Add("action", a)
	}

	result := h.dockerClient.Events(ctx, mobyClient.EventsListOptions{Filters: filters})

	for {
		select {
		case <-ctx.Done():
			return
		case err, ok := <-result.Err:
			if !ok || err != nil {
				return
			}
		case msg, ok := <-result.Messages:
			if !ok {
				return
			}
			data, _ := json.Marshal(msg)
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}
}

func StartMetricsBroadcast(wsHub *wslib.Hub, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			snap, err := metrics.Collect(context.Background())
			if err != nil {
				continue
			}
			data, _ := json.Marshal(snap)
			wsHub.Broadcast(wslib.Event{Type: "metrics", Data: json.RawMessage(data)})
		}
	}()
}

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/tomasweigenast/vps-manager/internal/metrics"
	"github.com/tomasweigenast/vps-manager/internal/sse"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

type systemHandler struct {
	metricsHub *sse.Hub
	wsHub      *wslib.Hub
}

func (h *systemHandler) metricsJSON(w http.ResponseWriter, r *http.Request) {
	snap, err := metrics.Collect(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, snap)
}

// metricsStream is kept for backwards compatibility.
func (h *systemHandler) metricsStream(w http.ResponseWriter, r *http.Request) {
	h.metricsHub.ServeHTTP(w, r)
}

func StartMetricsBroadcast(sseHub *sse.Hub, wsHub *wslib.Hub, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			snap, err := metrics.Collect(context.Background())
			if err != nil {
				continue
			}
			data, _ := json.Marshal(snap)
			sseHub.Broadcast(sse.Event{Type: "metrics", Data: json.RawMessage(data)})
			wsHub.Broadcast(wslib.Event{Type: "metrics", Data: json.RawMessage(data)})
		}
	}()
}

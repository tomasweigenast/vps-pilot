package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/tomasweigenast/vps-manager/internal/metrics"
	wslib "github.com/tomasweigenast/vps-manager/internal/ws"
)

type systemHandler struct {
	wsHub *wslib.Hub
}

func (h *systemHandler) metricsJSON(w http.ResponseWriter, r *http.Request) {
	snap, err := metrics.Collect(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, snap)
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

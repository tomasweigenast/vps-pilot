package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestMetricsJSON(t *testing.T) {
	srv, database, _ := newTestServer(t)
	// Metrics require view_dashboard permission; use an admin to skip permission check.
	password := createTestAdmin(t, database, "metricsuser")
	client := loginAs(t, srv, "metricsuser", password)

	resp, err := client.Get(srv.URL + "/api/metrics")
	if err != nil {
		t.Fatalf("GET /api/metrics: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("invalid JSON: %v — body: %s", err, body)
	}
	for _, key := range []string{"cpu", "memory", "timestamp"} {
		if _, ok := payload[key]; !ok {
			t.Errorf("expected key %q in metrics JSON", key)
		}
	}
}

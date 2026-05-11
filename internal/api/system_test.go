package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMetricsJSON(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "metricsuser")
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

func TestMetricsPartial(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "partialuser")
	client := loginAs(t, srv, "partialuser", password)

	resp, err := client.Get(srv.URL + "/partials/metrics")
	if err != nil {
		t.Fatalf("GET /partials/metrics: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "metrics-grid") {
		t.Errorf("expected metrics-grid in partial HTML, got: %s", body[:min(200, len(body))])
	}
}

func TestDashboard_Returns200(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "dashuser")
	client := loginAs(t, srv, "dashuser", password)

	resp, err := client.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

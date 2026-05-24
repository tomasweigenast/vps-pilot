package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
)

func TestLogin_Success(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "alice")

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	form := url.Values{"username": {"alice"}, "password": {password}}
	resp, err := client.Post(srv.URL+"/api/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /api/login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var payload map[string]string
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("expected JSON response: %v — body: %s", err, body)
	}
	if payload["username"] != "alice" {
		t.Errorf("expected username=alice in response, got: %v", payload)
	}

	hasCookie := false
	for _, c := range resp.Cookies() {
		if c.Name == "vpm_session" {
			hasCookie = true
			break
		}
	}
	if !hasCookie {
		t.Error("expected session cookie after login")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	srv, database, _ := newTestServer(t)
	createTestUser(t, database, "bob")

	form := url.Values{"username": {"bob"}, "password": {"wrongpassword"}}
	resp, err := http.Post(srv.URL+"/api/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /api/login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	srv, _, _ := newTestServer(t)

	form := url.Values{"username": {"nobody"}, "password": {"anything"}}
	resp, err := http.Post(srv.URL+"/api/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /api/login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestLogout(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "carol")
	client := loginAs(t, srv, "carol", password)

	resp, err := client.Post(srv.URL+"/api/logout", "application/x-www-form-urlencoded", nil)
	if err != nil {
		t.Fatalf("POST /api/logout: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("expected 204 from logout, got %d", resp.StatusCode)
	}
}

func TestRequireAuth_Unauthenticated(t *testing.T) {
	srv, _, _ := newTestServer(t)

	resp, err := http.Get(srv.URL + "/api/metrics")
	if err != nil {
		t.Fatalf("GET /api/metrics: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated API request, got %d", resp.StatusCode)
	}
}

func TestSPA_Returns200(t *testing.T) {
	srv, _, _ := newTestServer(t)
	// The SPA catch-all returns 200 for any non-API path (React Router handles routing client-side).
	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

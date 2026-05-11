package api_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestLogin_Success(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestUser(t, database, "alice")

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // stay on the 303
		},
	}

	form := url.Values{"username": {"alice"}, "password": {password}}
	resp, err := client.Post(srv.URL+"/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusSeeOther {
		t.Errorf("expected 303, got %d", resp.StatusCode)
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
	resp, err := http.Post(srv.URL+"/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /login: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	srv, _, _ := newTestServer(t)

	form := url.Values{"username": {"nobody"}, "password": {"anything"}}
	resp, err := http.Post(srv.URL+"/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /login: %v", err)
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

	resp, err := client.Post(srv.URL+"/logout", "application/x-www-form-urlencoded", nil)
	if err != nil {
		t.Fatalf("POST /logout: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusSeeOther {
		t.Errorf("expected 303 from logout, got %d", resp.StatusCode)
	}
}

func TestRequireAuth_Redirect(t *testing.T) {
	srv, _, _ := newTestServer(t)

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET /: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusSeeOther {
		t.Errorf("expected redirect for unauthenticated request, got %d", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if !strings.Contains(loc, "/login") {
		t.Errorf("expected redirect to /login, got %q", loc)
	}
}

func TestLoginPage_Returns200(t *testing.T) {
	srv, _, _ := newTestServer(t)
	resp, err := http.Get(srv.URL + "/login")
	if err != nil {
		t.Fatalf("GET /login: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

package api_test

import (
	"database/sql"
	"encoding/hex"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/tomasweigenast/vps-pilot/internal/api"
	"github.com/tomasweigenast/vps-pilot/internal/auth"
	"github.com/tomasweigenast/vps-pilot/internal/config"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/logbuffer"
)

const testSecretHex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

func testSecret(t *testing.T) []byte {
	t.Helper()
	b, _ := hex.DecodeString(testSecretHex)
	return b
}

// newTestServer starts an httptest.Server with a real SQLite DB and CSRF disabled.
// Returns the server, DB handle, and the temp data directory.
func newTestServer(t *testing.T) (*httptest.Server, *sql.DB, string) {
	t.Helper()
	dir := t.TempDir()
	database, err := db.Open(dir)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	cfg := &config.Config{
		CookieSecret: testSecret(t),
		AuthMode:     config.AuthModeLocal,
		FilesRootDir: dir,
		SkipCSRF:     true,
	}

	router := api.NewRouter(database, cfg, nil, logbuffer.New(logbuffer.DefaultSize), make([]byte, 32), nil, nil, nil)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv, database, dir
}

// createTestUser inserts a local user and returns the plain password.
func createTestUser(t *testing.T, database *sql.DB, username string) string {
	t.Helper()
	const password = "testpassword123"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	_, err = db.CreateUser(database, username, db.AuthTypeLocal, &hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return password
}

// makeTestUserAdmin assigns the system admin role to a user.
func makeTestUserAdmin(t *testing.T, database *sql.DB, userID int64) {
	t.Helper()
	var adminRoleID int64
	if err := database.QueryRow(`SELECT id FROM roles WHERE is_system = TRUE AND name = 'admin'`).Scan(&adminRoleID); err != nil {
		t.Fatalf("find admin role: %v", err)
	}
	if err := db.AssignRolesToUser(database, userID, []int64{adminRoleID}); err != nil {
		t.Fatalf("assign admin role: %v", err)
	}
}

// createTestAdmin inserts a local user with the admin role and returns the plain password.
func createTestAdmin(t *testing.T, database *sql.DB, username string) string {
	t.Helper()
	const password = "testpassword123"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	user, err := db.CreateUser(database, username, db.AuthTypeLocal, &hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	makeTestUserAdmin(t, database, user.ID)
	return password
}

// loginAs POSTs /api/login and returns an *http.Client that carries the session cookie.
func loginAs(t *testing.T, srv *httptest.Server, username, password string) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}

	form := url.Values{"username": {username}, "password": {password}}
	resp, err := client.Post(srv.URL+"/api/login", "application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		t.Fatalf("POST /api/login: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", resp.StatusCode)
	}
	return client
}

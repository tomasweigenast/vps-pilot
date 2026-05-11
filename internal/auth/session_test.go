package auth

import (
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testSecret(t *testing.T) []byte {
	t.Helper()
	b, err := hex.DecodeString("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSessionRoundtrip(t *testing.T) {
	sm := NewSessionManager(testSecret(t), false)

	want := SessionData{UserID: 42, Username: "alice", AuthType: "local"}

	// Encode into a response recorder
	w := httptest.NewRecorder()
	if err := sm.Set(w, want); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// Pull the Set-Cookie header and attach to a new request
	resp := w.Result()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	for _, c := range resp.Cookies() {
		req.AddCookie(c)
	}

	got, err := sm.Get(req)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.UserID != want.UserID || got.Username != want.Username || got.AuthType != want.AuthType {
		t.Errorf("roundtrip mismatch: got %+v, want %+v", got, want)
	}
}

func TestSession_TamperedCookie(t *testing.T) {
	sm := NewSessionManager(testSecret(t), false)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: "tampered.garbage.value"})

	_, err := sm.Get(req)
	if err == nil {
		t.Error("expected error for tampered cookie")
	}
}

func TestSession_MissingCookie(t *testing.T) {
	sm := NewSessionManager(testSecret(t), false)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	_, err := sm.Get(req)
	if err == nil {
		t.Error("expected error for missing cookie")
	}
}

func TestSession_Clear(t *testing.T) {
	sm := NewSessionManager(testSecret(t), false)
	w := httptest.NewRecorder()
	sm.Clear(w)

	resp := w.Result()
	for _, c := range resp.Cookies() {
		if c.Name == cookieName {
			if c.MaxAge != -1 {
				t.Errorf("expected MaxAge=-1 after Clear, got %d", c.MaxAge)
			}
			return
		}
	}
	t.Error("no Set-Cookie header found after Clear")
}

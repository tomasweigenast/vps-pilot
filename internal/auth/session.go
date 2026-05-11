package auth

import (
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/securecookie"
	"golang.org/x/crypto/hkdf"
)

const cookieName = "vpm_session"

type SessionData struct {
	UserID   int64  `json:"uid"`
	Username string `json:"usr"`
	AuthType string `json:"at"`
}

type SessionManager struct {
	sc     *securecookie.SecureCookie
	secure bool
}

func deriveKey(secret []byte, info string) []byte {
	r := hkdf.New(sha256.New, secret, nil, []byte(info))
	key := make([]byte, 32)
	io.ReadFull(r, key) //nolint:errcheck // hkdf never errors for valid inputs
	return key
}

func NewSessionManager(secret []byte, secure bool) *SessionManager {
	hashKey := deriveKey(secret, "vpm-cookie-hmac")
	blockKey := deriveKey(secret, "vpm-cookie-aes")
	sc := securecookie.New(hashKey, blockKey)
	sc.MaxAge(int((24 * time.Hour * 7).Seconds()))
	return &SessionManager{sc: sc, secure: secure}
}

func (m *SessionManager) Set(w http.ResponseWriter, data SessionData) error {
	encoded, err := m.sc.Encode(cookieName, data)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    encoded,
		Path:     "/",
		HttpOnly: true,
		Secure:   m.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((24 * time.Hour * 7).Seconds()),
	})
	return nil
}

func (m *SessionManager) Get(r *http.Request) (*SessionData, error) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return nil, errors.New("no session cookie")
	}
	var data SessionData
	if err := m.sc.Decode(cookieName, cookie.Value, &data); err != nil {
		slog.Debug("session decode failed", "err", err)
		return nil, errors.New("invalid session")
	}
	return &data, nil
}

func (m *SessionManager) Clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   m.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

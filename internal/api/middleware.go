package api

import (
	"log/slog"
	"net/http"

	"github.com/tomasweigenast/vps-manager/internal/auth"
)

func requireAuth(sm *auth.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, err := sm.Get(r)
			if err != nil {
				cookies := r.Cookies()
				slog.Warn("auth rejected", "path", r.URL.Path, "err", err, "cookies", len(cookies), "upgrade", r.Header.Get("Upgrade"))
				jsonErr(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			next.ServeHTTP(w, r.WithContext(withSession(r.Context(), session)))
		})
	}
}

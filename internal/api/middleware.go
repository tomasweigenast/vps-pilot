package api

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-manager/internal/auth"
	"github.com/tomasweigenast/vps-manager/internal/db"
)

func requireAuth(sm *auth.SessionManager, database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, err := sm.Get(r)
			if err != nil {
				slog.Debug("auth rejected", "path", r.URL.Path)
				jsonErr(w, http.StatusUnauthorized, "You must be logged in to access this resource")
				return
			}
			// Validate the session user still exists in DB (catches stale cookies after DB reset)
			if _, err := db.GetUserByID(database, session.UserID); err != nil {
				if errors.Is(err, db.ErrUserNotFound) {
					sm.Clear(w)
					slog.Debug("session user not found, clearing cookie", "user_id", session.UserID)
				}
				jsonErr(w, http.StatusUnauthorized, "You must be logged in to access this resource")
				return
			}
			next.ServeHTTP(w, r.WithContext(withSession(r.Context(), session)))
		})
	}
}

func requireAdmin(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session := sessionFromCtx(r.Context())
			isAdmin, err := db.IsUserAdmin(database, session.UserID)
			if err != nil {
				slog.Warn("requireAdmin: IsUserAdmin error", "user_id", session.UserID, "err", err)
				jsonErr(w, http.StatusInternalServerError, "Permission check failed")
				return
			}
			if !isAdmin {
				slog.Debug("requireAdmin: access denied", "user_id", session.UserID, "username", session.Username)
				jsonErr(w, http.StatusForbidden, "This action requires administrator privileges")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requirePermission(database *sql.DB, action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session := sessionFromCtx(r.Context())

			isAdmin, err := db.IsUserAdmin(database, session.UserID)
			if err != nil {
				jsonErr(w, http.StatusInternalServerError, "Permission check failed")
				return
			}
			if isAdmin {
				next.ServeHTTP(w, r)
				return
			}

			projectName := chi.URLParam(r, "name")
			ok, err := db.UserHasPermission(database, session.UserID, projectName, action)
			if err != nil {
				jsonErr(w, http.StatusInternalServerError, "Permission check failed")
				return
			}
			if !ok {
				jsonErr(w, http.StatusForbidden, fmt.Sprintf("You don't have permission to perform the %q action on project %q", action, projectName))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func requireGlobalPermission(database *sql.DB, action string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session := sessionFromCtx(r.Context())

			isAdmin, err := db.IsUserAdmin(database, session.UserID)
			if err != nil {
				jsonErr(w, http.StatusInternalServerError, "Permission check failed")
				return
			}
			if isAdmin {
				next.ServeHTTP(w, r)
				return
			}

			ok, err := db.UserHasPermission(database, session.UserID, "*", action)
			if err != nil {
				jsonErr(w, http.StatusInternalServerError, "Permission check failed")
				return
			}
			if !ok {
				jsonErr(w, http.StatusForbidden, "You don't have permission to access this section")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

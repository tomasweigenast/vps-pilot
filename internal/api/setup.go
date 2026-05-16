package api

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/tomasweigenast/vps-manager/internal/auth"
	"github.com/tomasweigenast/vps-manager/internal/db"
)

type setupHandler struct {
	database *sql.DB
}

func isSetupRequired(database *sql.DB) bool {
	count, err := db.CountUsers(database)
	if err != nil {
		slog.Warn("setup check failed", "err", err)
		return false
	}
	return count == 0
}

func setupRedirect(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/setup" || r.URL.Path == "/api/setup" {
				next.ServeHTTP(w, r)
				return
			}
			if isSetupRequired(database) {
				http.Redirect(w, r, "/setup", http.StatusFound)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (h *setupHandler) getSetup(w http.ResponseWriter, r *http.Request) {
	if !isSetupRequired(h.database) {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	// Return a marker so the SPA can show the setup page
	jsonOK(w, map[string]bool{"required": true})
}

func (h *setupHandler) postSetup(w http.ResponseWriter, r *http.Request) {
	if !isSetupRequired(h.database) {
		jsonErr(w, http.StatusConflict, "setup already completed")
		return
	}

	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Username == "" || body.Password == "" {
		jsonErr(w, http.StatusBadRequest, "username and password are required")
		return
	}

	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	user, err := db.CreateUser(h.database, body.Username, db.AuthTypeLocal, &hash)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	// Assign the system admin role (always ID=1 from migration seed)
	var adminRoleID int64
	if err := h.database.QueryRow(`SELECT id FROM roles WHERE is_system = TRUE AND name = 'admin'`).Scan(&adminRoleID); err != nil {
		slog.Error("admin role not found", "err", err)
		jsonErr(w, http.StatusInternalServerError, "admin role not found")
		return
	}

	if err := db.AssignRolesToUser(h.database, user.ID, []int64{adminRoleID}); err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to assign admin role")
		return
	}

	slog.Info("first admin user created", "username", user.Username)
	jsonOK(w, map[string]string{"username": user.Username})
}

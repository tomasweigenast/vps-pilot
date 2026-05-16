package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/tomasweigenast/vps-manager/internal/auth"
	"github.com/tomasweigenast/vps-manager/internal/config"
	"github.com/tomasweigenast/vps-manager/internal/db"
)

type authHandler struct {
	db       *sql.DB
	session  *auth.SessionManager
	authMode config.AuthMode
}

func (h *authHandler) login(w http.ResponseWriter, r *http.Request) {
	username := r.FormValue("username")
	password := r.FormValue("password")

	user, err := h.authenticate(r.Context(), username, password)
	if err != nil {
		slog.Warn("login failed", "username", username, "err", err)
		if errors.Is(err, auth.ErrUserDisabled) {
			jsonErr(w, http.StatusForbidden, "Account disabled")
			return
		}
		jsonErr(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	slog.Info("login success", "username", user.GetUsername(), "auth_type", user.GetAuthType())
	if err := h.session.Set(w, auth.SessionData{
		UserID:   user.GetID(),
		Username: user.GetUsername(),
		AuthType: user.GetAuthType(),
	}); err != nil {
		jsonErr(w, http.StatusInternalServerError, "session error")
		return
	}

	logAudit(r, h.db, "auth.login", user.GetUsername(), "")
	jsonOK(w, map[string]string{"username": user.GetUsername()})
}

func (h *authHandler) me(w http.ResponseWriter, r *http.Request) {
	session := sessionFromCtx(r.Context())
	isAdmin, _ := db.IsUserAdmin(h.db, session.UserID)
	perms, _ := db.GetUserGlobalPermissions(h.db, session.UserID)
	if perms == nil {
		perms = []string{}
	}
	jsonOK(w, map[string]any{
		"username":    session.Username,
		"isAdmin":     isAdmin,
		"permissions": perms,
	})
}

func (h *authHandler) logout(w http.ResponseWriter, r *http.Request) {
	h.session.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *authHandler) authenticate(ctx context.Context, username, password string) (interface {
	GetID() int64
	GetUsername() string
	GetAuthType() string
}, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	switch h.authMode {
	case config.AuthModePAM:
		u, err := auth.AuthenticatePAM(ctx, h.db, username, password)
		if err != nil {
			return nil, err
		}
		return &simpleUser{u.ID, u.Username, string(u.AuthType)}, nil
	case config.AuthModeLocal:
		u, err := auth.AuthenticateLocal(h.db, username, password)
		if err != nil {
			return nil, err
		}
		return &simpleUser{u.ID, u.Username, string(u.AuthType)}, nil
	default: // both — try PAM first, fall through to local
		u, err := auth.AuthenticatePAM(ctx, h.db, username, password)
		if err == nil {
			return &simpleUser{u.ID, u.Username, string(u.AuthType)}, nil
		}
		u2, err := auth.AuthenticateLocal(h.db, username, password)
		if err != nil {
			return nil, auth.ErrInvalidCredentials
		}
		return &simpleUser{u2.ID, u2.Username, string(u2.AuthType)}, nil
	}
}

type simpleUser struct {
	id       int64
	username string
	authType string
}

func (u *simpleUser) GetID() int64       { return u.id }
func (u *simpleUser) GetUsername() string { return u.username }
func (u *simpleUser) GetAuthType() string { return u.authType }

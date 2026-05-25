package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/auth"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/users"
)

type usersHandler struct {
	database *sql.DB
}

type userView struct {
	ID                int64          `json:"id"`
	Username          string         `json:"username"`
	AuthType          string         `json:"authType"`
	Disabled          bool           `json:"disabled"`
	Roles             []db.Role      `json:"roles"`
	CustomPermissions []db.Permission `json:"customPermissions"`
	LastLogin         *string        `json:"lastLogin"`
}

func (h *usersHandler) list(w http.ResponseWriter, r *http.Request) {
	linuxUsers, _ := users.ListLoginable()

	dbUsers, err := db.ListUsers(h.database)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	// Index DB users by username for quick lookup
	dbByName := make(map[string]db.User, len(dbUsers))
	for _, u := range dbUsers {
		dbByName[u.Username] = u
	}

	// Ensure all linux users have a DB record
	for _, lu := range linuxUsers {
		if _, ok := dbByName[lu.Username]; !ok {
			u, err := db.GetOrCreatePAMUser(h.database, lu.Username)
			if err == nil {
				dbByName[lu.Username] = *u
			}
		}
	}

	// Re-fetch full list after ensuring all linux users are in DB
	dbUsers, err = db.ListUsers(h.database)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	views := make([]userView, 0, len(dbUsers))
	for _, u := range dbUsers {
		allRoles, _ := db.GetUserRoles(h.database, u.ID)
		// Separate personal role permissions from public roles
		var publicRoles []db.Role
		for _, r := range allRoles {
			if len(r.Name) > len(db.PersonalRolePrefix) && r.Name[:len(db.PersonalRolePrefix)] == db.PersonalRolePrefix {
				continue
			}
			publicRoles = append(publicRoles, r)
		}
		if publicRoles == nil {
			publicRoles = []db.Role{}
		}
		customPerms, _ := db.GetPersonalRolePermissions(h.database, u.Username)
		if customPerms == nil {
			customPerms = []db.Permission{}
		}
		var lastLogin *string
		if u.LastLogin != nil {
			s := u.LastLogin.Format("2006-01-02T15:04:05Z")
			lastLogin = &s
		}
		views = append(views, userView{
			ID:                u.ID,
			Username:          u.Username,
			AuthType:          string(u.AuthType),
			Disabled:          u.Disabled,
			Roles:             publicRoles,
			CustomPermissions: customPerms,
			LastLogin:         lastLogin,
		})
	}

	jsonOK(w, views)
}

func (h *usersHandler) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username    string           `json:"username"`
		Password    string           `json:"password"`
		RoleIDs     []int64          `json:"roleIds"`
		Permissions []db.Permission  `json:"permissions"`
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
		jsonErr(w, http.StatusConflict, "username already exists")
		return
	}

	if len(body.RoleIDs) > 0 {
		db.AssignRolesToUser(h.database, user.ID, body.RoleIDs)
	}
	if len(body.Permissions) > 0 {
		db.UpsertPersonalRole(h.database, user.ID, user.Username, body.Permissions)
	}

	jsonOK(w, map[string]any{"id": user.ID, "username": user.Username})
}

func (h *usersHandler) update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var body struct {
		Disabled    *bool           `json:"disabled"`
		RoleIDs     []int64         `json:"roleIds"`
		Permissions []db.Permission `json:"permissions"`
		ClearPerms  bool            `json:"clearPermissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Prevent self-disable
	session := sessionFromCtx(r.Context())
	if session.UserID == id && body.Disabled != nil && *body.Disabled {
		jsonErr(w, http.StatusBadRequest, "cannot disable your own account")
		return
	}

	if body.Disabled != nil {
		if err := db.SetUserDisabled(h.database, id, *body.Disabled); err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to update user")
			return
		}
	}
	// Only update roles when explicitly provided: non-empty list OR clearPermissions=true (role mode).
	// An empty roleIds slice from custom-permissions mode must NOT wipe existing role assignments.
	if body.RoleIDs != nil && (len(body.RoleIDs) > 0 || body.ClearPerms) {
		// Prevent removing admin role from self
		if session.UserID == id {
			isAdmin, _ := db.IsUserAdmin(h.database, id)
			if isAdmin {
				// Check if admin role is still in the new list
				stillAdmin := false
				for _, rid := range body.RoleIDs {
					role, err := db.GetRole(h.database, rid)
					if err == nil && role.IsSystem && role.Name == "admin" {
						stillAdmin = true
						break
					}
				}
				if !stillAdmin {
					jsonErr(w, http.StatusBadRequest, "cannot remove your own admin role")
					return
				}
			}
		}
		if err := db.AssignRolesToUser(h.database, id, body.RoleIDs); err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to update roles")
			return
		}
	}
	if body.Permissions != nil || body.ClearPerms {
		user, err := db.GetUserByID(h.database, id)
		if err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to get user")
			return
		}
		if err := db.UpsertPersonalRole(h.database, id, user.Username, body.Permissions); err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to update permissions")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *usersHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid user id")
		return
	}

	session := sessionFromCtx(r.Context())
	if session.UserID == id {
		jsonErr(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}

	user, err := db.GetUserByID(h.database, id)
	if errors.Is(err, db.ErrUserNotFound) {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to get user")
		return
	}

	if user.AuthType == db.AuthTypePAM {
		// PAM users: disable instead of delete
		if err := db.SetUserDisabled(h.database, id, true); err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to disable user")
			return
		}
	} else {
		if err := db.DeleteUser(h.database, id); err != nil {
			jsonErr(w, http.StatusInternalServerError, "failed to delete user")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

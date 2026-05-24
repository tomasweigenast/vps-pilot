package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
)

type rolesHandler struct {
	database *sql.DB
}

func (h *rolesHandler) list(w http.ResponseWriter, r *http.Request) {
	roles, err := db.ListRoles(h.database)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "failed to list roles")
		return
	}
	if roles == nil {
		roles = []db.Role{}
	}
	jsonOK(w, roles)
}

func (h *rolesHandler) create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string           `json:"name"`
		Description string           `json:"description"`
		Permissions []db.Permission  `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		jsonErr(w, http.StatusBadRequest, "name is required")
		return
	}

	role, err := db.CreateRole(h.database, body.Name, body.Description, body.Permissions)
	if err != nil {
		jsonErr(w, http.StatusConflict, "role name already exists")
		return
	}
	jsonOK(w, role)
}

func (h *rolesHandler) update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid role id")
		return
	}

	var body struct {
		Name        string           `json:"name"`
		Description string           `json:"description"`
		Permissions []db.Permission  `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := db.UpdateRole(h.database, id, body.Name, body.Description, body.Permissions); err != nil {
		if errors.Is(err, db.ErrSystemRole) {
			jsonErr(w, http.StatusForbidden, "cannot modify system role")
			return
		}
		if errors.Is(err, db.ErrRoleNotFound) {
			jsonErr(w, http.StatusNotFound, "role not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "failed to update role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *rolesHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid role id")
		return
	}

	if err := db.DeleteRole(h.database, id); err != nil {
		if errors.Is(err, db.ErrSystemRole) {
			jsonErr(w, http.StatusForbidden, "cannot delete system role")
			return
		}
		if errors.Is(err, db.ErrRoleNotFound) {
			jsonErr(w, http.StatusNotFound, "role not found")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "failed to delete role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

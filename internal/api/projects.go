package api

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-manager/internal/db"
	"github.com/tomasweigenast/vps-manager/internal/docker"
)

var validProjectName = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

type projectsHandler struct {
	manager  *docker.Manager
	database *sql.DB
}

func (h *projectsHandler) deleteProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	if err := db.DeleteProject(h.database, name); err != nil {
		if errors.Is(err, db.ErrProjectNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, "delete project")
		return
	}

	_ = h.manager.Destroy(r.Context(), name)
	_ = h.manager.DeleteProjectFiles(name)
	logAudit(r, h.database, "project.delete", name, "")
	w.WriteHeader(http.StatusNoContent)
}

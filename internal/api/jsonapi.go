package api

// JSON API handlers for the React SPA.
// These parallel the existing HTML-returning handlers without touching them.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-manager/internal/db"
	"github.com/tomasweigenast/vps-manager/internal/files"
)

// --- Projects JSON API ---

func (h *dockerHandler) apiListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.manager.ListProjects(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, projects)
}

func (h *dockerHandler) apiStartProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Start(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiStopProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Stop(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiRestartProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Restart(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiContainerAction(w http.ResponseWriter, r *http.Request) {
	containerID := chi.URLParam(r, "id")
	action := chi.URLParam(r, "action")
	if err := h.manager.ContainerAction(r.Context(), containerID, action); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Projects CRUD JSON API ---

type projectInput struct {
	Name           string            `json:"name"`
	ComposeContent string            `json:"composeContent"`
	Env            map[string]string `json:"env,omitempty"`
}

func (h *projectsHandler) apiCreateProject(w http.ResponseWriter, r *http.Request) {
	var inp projectInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	inp.Name = strings.TrimSpace(inp.Name)
	inp.ComposeContent = strings.TrimSpace(inp.ComposeContent)

	if !validProjectName.MatchString(inp.Name) {
		jsonErr(w, http.StatusBadRequest, "invalid project name")
		return
	}
	if inp.ComposeContent == "" {
		jsonErr(w, http.StatusBadRequest, "composeContent is required")
		return
	}

	rec, err := db.CreateProject(h.database, inp.Name, inp.ComposeContent, inp.Env)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = h.manager.SyncProject(*rec)
	w.WriteHeader(http.StatusCreated)
}

func (h *projectsHandler) apiUpdateProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var inp projectInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	inp.ComposeContent = strings.TrimSpace(inp.ComposeContent)
	if inp.ComposeContent == "" {
		jsonErr(w, http.StatusBadRequest, "composeContent is required")
		return
	}

	if err := db.UpdateProject(h.database, name, inp.ComposeContent, inp.Env); err != nil {
		if errors.Is(err, db.ErrProjectNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	rec, err := db.GetProjectByName(h.database, name)
	if err == nil {
		_ = h.manager.SyncProject(*rec)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *projectsHandler) apiGetProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	rec, err := db.GetProjectByName(h.database, name)
	if err != nil {
		if errors.Is(err, db.ErrProjectNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	projectFiles, _ := db.ListProjectFiles(h.database, name)
	type projectDetail struct {
		ID        int64             `json:"id"`
		Name      string            `json:"name"`
		Compose   string            `json:"compose"`
		EnvVars   map[string]string `json:"envVars"`
		CreatedAt string            `json:"createdAt"`
		UpdatedAt string            `json:"updatedAt"`
		Files     []db.ProjectFile  `json:"files"`
	}
	jsonOK(w, projectDetail{
		ID:        rec.ID,
		Name:      rec.Name,
		Compose:   rec.Compose,
		EnvVars:   rec.EnvVars,
		CreatedAt: rec.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: rec.UpdatedAt.Format("2006-01-02T15:04:05.000Z"),
		Files:     projectFiles,
	})
}

func (h *projectsHandler) apiListProjectFiles(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	files, err := db.ListProjectFiles(h.database, name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, files)
}

func (h *projectsHandler) apiUpsertProjectFile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var inp struct {
		Filename string `json:"filename"`
		Content  string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	inp.Filename = strings.TrimSpace(inp.Filename)
	if inp.Filename == "" {
		jsonErr(w, http.StatusBadRequest, "filename is required")
		return
	}
	if err := db.UpsertProjectFile(h.database, name, inp.Filename, inp.Content); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rec, err := db.GetProjectByName(h.database, name)
	if err == nil {
		_ = h.manager.SyncProject(*rec)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *projectsHandler) apiDeleteProjectFile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	filename := chi.URLParam(r, "filename")
	if err := db.DeleteProjectFile(h.database, name, filename); err != nil {
		if errors.Is(err, db.ErrProjectFileNotFound) {
			http.NotFound(w, r)
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Files JSON API ---

func (h *filesHandler) apiList(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}
	entries, err := h.browser.List(path)
	if err != nil {
		if errors.Is(err, files.ErrForbidden) {
			jsonErr(w, http.StatusForbidden, "forbidden")
			return
		}
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, entries)
}

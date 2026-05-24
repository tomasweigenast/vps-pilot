package api

// JSON API handlers for the React SPA.
// These parallel the existing HTML-returning handlers without touching them.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/files"
)

// --- Projects JSON API ---

func (h *dockerHandler) apiListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.manager.ListProjects(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	session := sessionFromCtx(r.Context())
	isAdmin, _ := db.IsUserAdmin(h.database, session.UserID)
	if !isAdmin {
		filtered := projects[:0]
		for _, p := range projects {
			if ok, _ := db.UserHasPermission(h.database, session.UserID, p.Name, "view"); ok {
				filtered = append(filtered, p)
			}
		}
		projects = filtered
	}

	jsonOK(w, projects)
}

func (h *dockerHandler) apiStartProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Start(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "project.start", name, "")
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiStopProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Stop(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "project.stop", name, "")
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiRestartProject(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.manager.Restart(r.Context(), name); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "project.restart", name, "")
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiContainerAction(w http.ResponseWriter, r *http.Request) {
	containerID := chi.URLParam(r, "id")
	action := chi.URLParam(r, "action")
	name := chi.URLParam(r, "name")
	if err := h.manager.ContainerAction(r.Context(), containerID, action); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "container."+action, name+"/"+containerID, "")
	w.WriteHeader(http.StatusNoContent)
}

// --- Projects CRUD JSON API ---

type projectInput struct {
	Name           string            `json:"name"`
	Description    string            `json:"description"`
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

	session := sessionFromCtx(r.Context())
	rec, err := db.CreateProject(h.database, inp.Name, inp.Description, inp.ComposeContent, session.Username, inp.Env)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = h.manager.SyncProject(*rec)
	logAudit(r, h.database, "project.create", inp.Name, "")
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

	if err := db.UpdateProject(h.database, name, inp.Description, inp.ComposeContent, inp.Env); err != nil {
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
	logAudit(r, h.database, "project.update", name, "")
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
		ID                int64             `json:"id"`
		Name              string            `json:"name"`
		Description       string            `json:"description"`
		Compose           string            `json:"compose"`
		EnvVars           map[string]string `json:"envVars"`
		CreatedBy         string            `json:"createdBy"`
		CreatedAt         string            `json:"createdAt"`
		UpdatedAt         string            `json:"updatedAt"`
		Files             []db.ProjectFile  `json:"files"`
		RemoveStaleImages bool              `json:"removeStaleImages"`
	}
	jsonOK(w, projectDetail{
		ID:                rec.ID,
		Name:              rec.Name,
		Description:       rec.Description,
		Compose:           rec.Compose,
		EnvVars:           rec.EnvVars,
		CreatedBy:         rec.CreatedBy,
		CreatedAt:         rec.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:         rec.UpdatedAt.Format("2006-01-02T15:04:05.000Z"),
		Files:             projectFiles,
		RemoveStaleImages: rec.RemoveStaleImages,
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
	logAudit(r, h.database, "project.file.upsert", name+"/"+inp.Filename, "")
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
	logAudit(r, h.database, "project.file.delete", name+"/"+filename, "")
	w.WriteHeader(http.StatusNoContent)
}

// apiPatchProjectConfig updates lightweight project config flags (e.g. remove_stale_images).
func (h *projectsHandler) apiPatchProjectConfig(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var inp struct {
		RemoveStaleImages *bool `json:"removeStaleImages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.RemoveStaleImages != nil {
		if err := db.SetRemoveStaleImages(h.database, name, *inp.RemoveStaleImages); err != nil {
			if errors.Is(err, db.ErrProjectNotFound) {
				http.NotFound(w, r)
				return
			}
			jsonErr(w, http.StatusInternalServerError, err.Error())
			return
		}
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
			jsonErr(w, http.StatusForbidden, "Path is outside the allowed root")
			return
		}
		jsonErr(w, http.StatusInternalServerError, "Failed to list directory: "+err.Error())
		return
	}
	jsonOK(w, entries)
}

package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

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

	_ = h.manager.DeleteProjectFiles(name)
	w.WriteHeader(http.StatusNoContent)
}

// parseEnvText converts "KEY=VALUE\n..." text into a map, ignoring blank lines and comments.
func parseEnvText(raw string) map[string]string {
	result := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		result[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return result
}

type extraFileInput struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

// parseFilesJSON decodes the JSON array submitted by the project form's extra_files field.
func parseFilesJSON(raw string) []extraFileInput {
	if raw == "" {
		return nil
	}
	var files []extraFileInput
	_ = json.Unmarshal([]byte(raw), &files)
	out := files[:0]
	for _, f := range files {
		if strings.TrimSpace(f.Filename) != "" {
			out = append(out, f)
		}
	}
	return out
}

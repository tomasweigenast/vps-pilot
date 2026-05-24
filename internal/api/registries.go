package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	dockerpkg "github.com/tomasweigenast/vps-pilot/internal/docker"
)

type registriesHandler struct {
	database *sql.DB
}

type registryInput struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

func (h *registriesHandler) list(w http.ResponseWriter, r *http.Request) {
	regs, err := db.ListRegistries(h.database)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Mask secrets in list response.
	type safeRegistry struct {
		ID        int64  `json:"id"`
		Name      string `json:"name"`
		URL       string `json:"url"`
		Username  string `json:"username"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}
	out := make([]safeRegistry, len(regs))
	for i, reg := range regs {
		out[i] = safeRegistry{
			ID:        reg.ID,
			Name:      reg.Name,
			URL:       reg.URL,
			Username:  reg.Username,
			CreatedAt: reg.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
			UpdatedAt: reg.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		}
	}
	jsonOK(w, out)
}

func (h *registriesHandler) create(w http.ResponseWriter, r *http.Request) {
	var inp registryInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Name == "" || inp.URL == "" || inp.Username == "" || inp.Secret == "" {
		jsonErr(w, http.StatusBadRequest, "name, url, username and secret are required")
		return
	}

	if err := dockerpkg.LoginRegistry(r.Context(), inp.URL, inp.Username, inp.Secret); err != nil {
		jsonErr(w, http.StatusBadRequest, "docker login failed: "+err.Error())
		return
	}

	reg, err := db.CreateRegistry(h.database, inp.Name, inp.URL, inp.Username, inp.Secret)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "registry.create", inp.URL, inp.Name)
	jsonOK(w, reg)
}

func (h *registriesHandler) update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var inp registryInput
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Name == "" || inp.URL == "" || inp.Username == "" {
		jsonErr(w, http.StatusBadRequest, "name, url and username are required")
		return
	}

	// Fetch existing secret if not provided.
	existing, err := db.GetRegistry(h.database, id)
	if errors.Is(err, db.ErrRegistryNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if inp.Secret == "" {
		inp.Secret = existing.Secret
	}

	if err := dockerpkg.LoginRegistry(r.Context(), inp.URL, inp.Username, inp.Secret); err != nil {
		jsonErr(w, http.StatusBadRequest, "docker login failed: "+err.Error())
		return
	}

	if err := db.UpdateRegistry(h.database, id, inp.Name, inp.URL, inp.Username, inp.Secret); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "registry.update", inp.URL, inp.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (h *registriesHandler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	reg, err := db.GetRegistry(h.database, id)
	if errors.Is(err, db.ErrRegistryNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = dockerpkg.LogoutRegistry(context.Background(), reg.URL)
	if err := db.DeleteRegistry(h.database, id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "registry.delete", reg.URL, reg.Name)
	w.WriteHeader(http.StatusNoContent)
}

func (h *registriesHandler) test(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	reg, err := db.GetRegistry(h.database, id)
	if errors.Is(err, db.ErrRegistryNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := dockerpkg.LoginRegistry(r.Context(), reg.URL, reg.Username, reg.Secret); err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

// GET /api/registries/{id}/repositories
func (h *registriesHandler) listRepositories(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	reg, err := db.GetRegistry(h.database, id)
	if errors.Is(err, db.ErrRegistryNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	repos, err := dockerpkg.ListRepositories(r.Context(), reg)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, repos)
}

// GET /api/registries/{id}/repositories/{name}/tags
// The repo name may contain slashes, so we use the remainder of the URL after /repositories/.
func (h *registriesHandler) listRepoTags(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	repoName := chi.URLParam(r, "*")
	// Strip trailing /tags
	repoName = strings.TrimSuffix(repoName, "/tags")
	if repoName == "" {
		jsonErr(w, http.StatusBadRequest, "repo name required")
		return
	}
	reg, err := db.GetRegistry(h.database, id)
	if errors.Is(err, db.ErrRegistryNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	tags, err := dockerpkg.ListRepoTags(r.Context(), repoName, reg)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, tags)
}

// GET /api/images/tags?image=nginx&q=1.25&registryId=1
// Searches tags for a Docker image. Uses the specified registry (by ID) for auth,
// or falls back to anonymous Docker Hub access.
func (h *registriesHandler) searchImageTags(w http.ResponseWriter, r *http.Request) {
	image := r.URL.Query().Get("image")
	if image == "" {
		jsonErr(w, http.StatusBadRequest, "image param required")
		return
	}
	q := r.URL.Query().Get("q")
	registryIDStr := r.URL.Query().Get("registryId")

	var reg *db.Registry
	if registryIDStr != "" {
		id, err := strconv.ParseInt(registryIDStr, 10, 64)
		if err == nil {
			if r2, err := db.GetRegistry(h.database, id); err == nil {
				reg = r2
			}
		}
	}
	if reg == nil {
		// Anonymous Docker Hub access for public images.
		reg = &db.Registry{URL: "docker.io"}
	}

	tags, err := dockerpkg.ListRegistryTags(r.Context(), image, reg)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Filter by q (case-insensitive substring match).
	if q != "" {
		filtered := make([]string, 0, len(tags))
		for _, t := range tags {
			if strings.Contains(strings.ToLower(t), strings.ToLower(q)) {
				filtered = append(filtered, t)
			}
		}
		tags = filtered
	}

	// Sort newest first: semver desc → date desc → lexicographic desc.
	sort.Slice(tags, func(i, j int) bool {
		return dockerpkg.CompareTags(tags[i], tags[j]) > 0
	})

	// Cap at 50 results.
	if len(tags) > 50 {
		tags = tags[:50]
	}

	jsonOK(w, tags)
}

package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
)

type containersHandler struct {
	manager *docker.Manager
}

// GET /api/containers?all=true
func (h *containersHandler) list(w http.ResponseWriter, r *http.Request) {
	all := r.URL.Query().Get("all") == "true"
	containers, err := h.manager.ListAllContainers(r.Context(), all)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, containers)
}

// POST /api/containers
func (h *containersHandler) create(w http.ResponseWriter, r *http.Request) {
	var req docker.CreateContainerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Image == "" {
		jsonErr(w, http.StatusBadRequest, "image is required")
		return
	}

	id, err := h.manager.CreateAndStartContainer(r.Context(), req)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]string{"id": id})
}

// DELETE /api/containers/{id}
func (h *containersHandler) remove(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		jsonErr(w, http.StatusBadRequest, "container id required")
		return
	}
	if err := h.manager.RemoveContainer(r.Context(), id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

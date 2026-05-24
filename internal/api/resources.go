package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
)

// --- Global resource lists ---

func (h *dockerHandler) apiListNetworks(w http.ResponseWriter, r *http.Request) {
	networks, err := h.manager.ListAllNetworks(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, networks)
}

func (h *dockerHandler) apiListVolumes(w http.ResponseWriter, r *http.Request) {
	volumes, err := h.manager.ListAllVolumes(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, volumes)
}

func (h *dockerHandler) apiListImages(w http.ResponseWriter, r *http.Request) {
	images, err := h.manager.ListAllImages(r.Context())
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, images)
}

func (h *dockerHandler) apiGetNetwork(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "networkID")
	detail, err := h.manager.InspectNetwork(r.Context(), id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, detail)
}

func (h *dockerHandler) apiGetVolume(w http.ResponseWriter, r *http.Request) {
	volName := chi.URLParam(r, "vol")
	detail, err := h.manager.InspectVolume(r.Context(), volName)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, detail)
}

// --- Networks (per-project) ---

func (h *dockerHandler) apiListProjectNetworks(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	networks, err := h.manager.ListProjectNetworks(r.Context(), name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, networks)
}

func (h *dockerHandler) apiGetProjectNetwork(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "networkID")
	detail, err := h.manager.InspectNetwork(r.Context(), id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, detail)
}

// --- Volumes ---

func (h *dockerHandler) apiListProjectVolumes(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	volumes, err := h.manager.ListProjectVolumes(r.Context(), name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, volumes)
}

func (h *dockerHandler) apiGetProjectVolume(w http.ResponseWriter, r *http.Request) {
	volName := chi.URLParam(r, "vol")
	detail, err := h.manager.InspectVolume(r.Context(), volName)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, detail)
}

// --- Images ---

func (h *dockerHandler) apiListProjectImages(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	images, err := h.manager.ListProjectImages(r.Context(), name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, images)
}

func (h *dockerHandler) apiDeleteImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	force := r.URL.Query().Get("force") == "true"
	if err := h.manager.RemoveImage(r.Context(), id, force); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "image.delete", id, "")
	w.WriteHeader(http.StatusNoContent)
}

// --- Network CRUD ---

func (h *dockerHandler) apiCreateNetwork(w http.ResponseWriter, r *http.Request) {
	var req docker.CreateNetworkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		jsonErr(w, http.StatusBadRequest, "name is required")
		return
	}
	id, err := h.manager.CreateNetwork(r.Context(), req)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "network.create", req.Name, "")
	jsonOK(w, map[string]string{"id": id})
}

func (h *dockerHandler) apiDeleteNetwork(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "networkID")
	if err := h.manager.DeleteNetwork(r.Context(), id); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "network.delete", id, "")
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiConnectContainer(w http.ResponseWriter, r *http.Request) {
	networkID := chi.URLParam(r, "networkID")
	var body struct {
		ContainerID string `json:"containerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ContainerID == "" {
		jsonErr(w, http.StatusBadRequest, "containerId required")
		return
	}
	if err := h.manager.ConnectContainerToNetwork(r.Context(), networkID, body.ContainerID); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *dockerHandler) apiDisconnectContainer(w http.ResponseWriter, r *http.Request) {
	networkID := chi.URLParam(r, "networkID")
	var body struct {
		ContainerID string `json:"containerId"`
		Force       bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ContainerID == "" {
		jsonErr(w, http.StatusBadRequest, "containerId required")
		return
	}
	if err := h.manager.DisconnectContainerFromNetwork(r.Context(), networkID, body.ContainerID, body.Force); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Volume CRUD ---

func (h *dockerHandler) apiCreateVolume(w http.ResponseWriter, r *http.Request) {
	var req docker.CreateVolumeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, err := h.manager.CreateVolume(r.Context(), req)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "volume.create", name, "")
	jsonOK(w, map[string]string{"name": name})
}

func (h *dockerHandler) apiDeleteVolume(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "vol")
	force := r.URL.Query().Get("force") == "true"
	if err := h.manager.DeleteVolume(r.Context(), name, force); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	logAudit(r, h.database, "volume.delete", name, "")
	w.WriteHeader(http.StatusNoContent)
}

// --- Update Check ---

// GET /api/projects/{name}/updates — check if images have updates available
func (h *dockerHandler) apiCheckProjectUpdates(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	status, err := h.manager.CheckProjectUpdates(r.Context(), name)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, status)
}

// --- Container Inspect ---

func (h *dockerHandler) apiInspectContainer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	detail, err := h.manager.InspectContainer(r.Context(), id)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, detail)
}

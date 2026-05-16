package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
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

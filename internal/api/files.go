package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/tomasweigenast/vps-manager/internal/files"
)

type filesHandler struct {
	browser *files.Browser
}

func (h *filesHandler) download(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		jsonErr(w, http.StatusForbidden, "Path is outside the allowed root")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(absPath)+`"`)
	http.ServeFile(w, r, absPath)
}

func (h *filesHandler) content(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		jsonErr(w, http.StatusForbidden, "Path is outside the allowed root")
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "File not found")
		return
	}
	if info.IsDir() {
		jsonErr(w, http.StatusBadRequest, "Path is a directory, not a file")
		return
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to read file: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"content": string(data), "path": rawPath})
}

func (h *filesHandler) update(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		jsonErr(w, http.StatusForbidden, "Path is outside the allowed root")
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "File not found")
		return
	}
	if info.IsDir() {
		jsonErr(w, http.StatusBadRequest, "Path is a directory, not a file")
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := os.WriteFile(absPath, []byte(body.Content), info.Mode()); err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to write file: "+err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *filesHandler) delete(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		jsonErr(w, http.StatusForbidden, "Path is outside the allowed root")
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "File not found")
		return
	}
	if info.IsDir() {
		err = os.RemoveAll(absPath)
	} else {
		err = os.Remove(absPath)
	}
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to delete \""+filepath.Base(absPath)+"\": "+err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}


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
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(absPath)+`"`)
	http.ServeFile(w, r, absPath)
}

func (h *filesHandler) content(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"content": string(data), "path": rawPath})
}

func (h *filesHandler) update(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if info.IsDir() {
		http.Error(w, "path is a directory", http.StatusBadRequest)
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if err := os.WriteFile(absPath, []byte(body.Content), info.Mode()); err != nil {
		http.Error(w, "write error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *filesHandler) delete(w http.ResponseWriter, r *http.Request) {
	rawPath := r.URL.Query().Get("path")
	absPath, err := h.browser.AbsPath(rawPath)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	info, err := os.Stat(absPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if info.IsDir() {
		err = os.RemoveAll(absPath)
	} else {
		err = os.Remove(absPath)
	}
	if err != nil {
		http.Error(w, "delete error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

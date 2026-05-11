package api

import (
	"net/http"
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

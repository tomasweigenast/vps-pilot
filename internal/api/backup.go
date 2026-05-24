package api

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/tomasweigenast/vps-pilot/internal/backup"
)

type backupHandler struct {
	database    *sql.DB
	dataDir     string
	projectsDir string
}

// GET /api/backup — download a backup ZIP
func (h *backupHandler) download(w http.ResponseWriter, r *http.Request) {
	data, err := backup.Export(r.Context(), h.database, h.dataDir, h.projectsDir)
	if err != nil {
		serverErr(w, r, "backup export", err)
		return
	}

	filename := fmt.Sprintf("vps-pilot-backup-%s.zip", time.Now().UTC().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.WriteHeader(http.StatusOK)
	w.Write(data) //nolint:errcheck
}

// POST /api/restore — upload and apply a backup ZIP
// Multipart form field: "backup" (the zip file)
func (h *backupHandler) restore(w http.ResponseWriter, r *http.Request) {
	// Limit upload to 500 MB
	r.Body = http.MaxBytesReader(w, r.Body, 500<<20)

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		jsonErr(w, http.StatusBadRequest, "failed to parse upload: "+err.Error())
		return
	}

	file, _, err := r.FormFile("backup")
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "field 'backup' is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		serverErr(w, r, "read backup upload", err)
		return
	}

	manifest, err := backup.Import(data, h.dataDir, h.projectsDir)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "restore failed: "+err.Error())
		return
	}

	jsonOK(w, map[string]any{
		"ok":        true,
		"createdAt": manifest.CreatedAt,
		"note":      "Database restored. Restart the service to complete the restore.",
	})
}

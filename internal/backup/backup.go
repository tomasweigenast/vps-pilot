// Package backup exports and imports the application data as a ZIP archive.
// The backup includes:
//   - A raw copy of the SQLite database file (using the online backup API via VACUUM INTO)
//   - All project files from disk (compose files, .env, extras)
//   - A metadata JSON with version and timestamp
package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const manifestFile = "manifest.json"
const dbFile = "vps-pilot.db"

// composeFiles lists filenames that identify a directory as a compose project.
var composeFiles = []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}

// Manifest contains metadata about the backup.
type Manifest struct {
	Version   string    `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
}

// Export creates a ZIP containing the database snapshot and all project files.
// dataDir is the directory where vps-pilot.db lives.
// projectsDir is the root directory of Docker Compose projects (may be empty).
func Export(ctx context.Context, db *sql.DB, dataDir, projectsDir string) ([]byte, error) {
	// Use VACUUM INTO to create an online backup into a temp file.
	tmpFile := filepath.Join(dataDir, fmt.Sprintf("backup_%d.db", time.Now().UnixNano()))
	defer os.Remove(tmpFile)

	if _, err := db.ExecContext(ctx, "VACUUM INTO ?", tmpFile); err != nil {
		return nil, fmt.Errorf("vacuum into temp backup: %w", err)
	}

	dbData, err := os.ReadFile(tmpFile)
	if err != nil {
		return nil, fmt.Errorf("read backup db: %w", err)
	}

	// Build ZIP
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)

	// Write manifest
	manifest := Manifest{
		Version:   "2",
		CreatedAt: time.Now().UTC(),
	}
	manifestJSON, _ := json.Marshal(manifest)
	if err := writeZipEntry(zw, manifestFile, manifestJSON); err != nil {
		return nil, err
	}

	// Write database
	if err := writeZipEntry(zw, dbFile, dbData); err != nil {
		return nil, err
	}

	// Write project files (best-effort: skip on permission errors)
	if projectsDir != "" {
		if err := addProjectFiles(zw, projectsDir); err != nil {
			return nil, fmt.Errorf("add project files: %w", err)
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// addProjectFiles walks projectsDir and adds each project directory to the ZIP
// under "projects/{projectName}/".  Only directories that contain a compose
// file are included; individual files inside are added recursively.
func addProjectFiles(zw *zip.Writer, projectsDir string) error {
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		projectName := entry.Name()
		projectPath := filepath.Join(projectsDir, projectName)

		// Only include directories that look like compose projects.
		isCompose := false
		for _, cf := range composeFiles {
			if _, err := os.Stat(filepath.Join(projectPath, cf)); err == nil {
				isCompose = true
				break
			}
		}
		if !isCompose {
			continue
		}

		// Walk all files in the project directory
		err := filepath.WalkDir(projectPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, _ := filepath.Rel(projectsDir, path)
			zipPath := "projects/" + filepath.ToSlash(rel)
			data, err := os.ReadFile(path)
			if err != nil {
				return nil // skip unreadable files
			}
			return writeZipEntry(zw, zipPath, data)
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// Import restores the database and project files from a ZIP archive.
// It writes the database file to dataDir and project files to projectsDir.
// The caller is responsible for restarting/reconnecting the database.
func Import(zipData []byte, dataDir, projectsDir string) (*Manifest, error) {
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("read zip: %w", err)
	}

	var manifest *Manifest
	var dbData []byte
	projectFiles := map[string][]byte{}

	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open zip entry %s: %w", f.Name, err)
		}
		data, err := io.ReadAll(io.LimitReader(rc, 500<<20)) // max 500 MB
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("read zip entry %s: %w", f.Name, err)
		}

		switch {
		case f.Name == manifestFile:
			manifest = &Manifest{}
			if err := json.Unmarshal(data, manifest); err != nil {
				return nil, fmt.Errorf("parse manifest: %w", err)
			}
		case f.Name == dbFile || f.Name == "vps-manager.db": // support v1 backups
			dbData = data
		case strings.HasPrefix(f.Name, "projects/"):
			projectFiles[f.Name] = data
		}
	}

	if manifest == nil {
		return nil, fmt.Errorf("backup zip is missing manifest.json")
	}
	if dbData == nil {
		return nil, fmt.Errorf("backup zip is missing database file")
	}
	if manifest.Version != "1" && manifest.Version != "2" {
		return nil, fmt.Errorf("unsupported backup version: %s", manifest.Version)
	}

	// Write the database file atomically
	dest := filepath.Join(dataDir, "vps-pilot.db")
	tmp := dest + ".restore"
	if err := os.WriteFile(tmp, dbData, 0o600); err != nil {
		return nil, fmt.Errorf("write restore db: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return nil, fmt.Errorf("rename restore db: %w", err)
	}

	// Restore project files (only if projectsDir is set and backup has files)
	if projectsDir != "" && len(projectFiles) > 0 {
		for zipPath, data := range projectFiles {
			// zipPath is like "projects/myapp/docker-compose.yml"
			rel := strings.TrimPrefix(zipPath, "projects/")
			dest := filepath.Join(projectsDir, filepath.FromSlash(rel))

			// Prevent path traversal
			if !strings.HasPrefix(dest, filepath.Clean(projectsDir)+string(os.PathSeparator)) {
				continue
			}

			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				continue // best-effort
			}
			_ = os.WriteFile(dest, data, 0o644) // best-effort
		}
	}

	return manifest, nil
}

func writeZipEntry(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.Create(name)
	if err != nil {
		return fmt.Errorf("create zip entry %s: %w", name, err)
	}
	_, err = w.Write(data)
	return err
}

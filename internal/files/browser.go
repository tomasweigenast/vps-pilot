package files

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Entry struct {
	Name        string      `json:"name"`
	Path        string      `json:"path"`
	IsDir       bool        `json:"isDir"`
	Size        int64       `json:"size"`
	ModTime     time.Time   `json:"modTime"`
	Permissions fs.FileMode `json:"permissions"`
}

var ErrForbidden = errors.New("path outside allowed root")

type Browser struct {
	root string
}

func NewBrowser(root string) *Browser {
	return &Browser{root: filepath.Clean(root)}
}

func (b *Browser) safePath(rawPath string) (string, error) {
	if rawPath == "" {
		rawPath = "/"
	}
	// Join under root
	joined := filepath.Join(b.root, filepath.FromSlash(rawPath))
	// Ensure it stays within root
	rel, err := filepath.Rel(b.root, joined)
	if err != nil || strings.HasPrefix(rel, "..") {
		slog.Warn("file traversal blocked", "requested", rawPath, "root", b.root)
		return "", ErrForbidden
	}
	return joined, nil
}

func (b *Browser) List(rawPath string) ([]Entry, error) {
	absPath, err := b.safePath(rawPath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	result := make([]Entry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		relToRoot, _ := filepath.Rel(b.root, filepath.Join(absPath, e.Name()))
		result = append(result, Entry{
			Name:        e.Name(),
			Path:        "/" + filepath.ToSlash(relToRoot),
			IsDir:       e.IsDir(),
			Size:        info.Size(),
			ModTime:     info.ModTime(),
			Permissions: info.Mode().Perm(),
		})
	}
	return result, nil
}

func (b *Browser) AbsPath(rawPath string) (string, error) {
	return b.safePath(rawPath)
}

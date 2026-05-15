package api

import (
	"archive/tar"
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moby/moby/client"
	"github.com/tomasweigenast/vps-manager/internal/docker"
)

type containerFilesHandler struct {
	manager *docker.Manager
}

type containerDirEntry struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"isDir"`
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"`
	ModTime time.Time `json:"modTime"`
}

func (h *containerFilesHandler) listDir(w http.ResponseWriter, r *http.Request) {
	containerID := chi.URLParam(r, "id")
	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		dirPath = "/"
	}
	dirPath = path.Clean("/" + dirPath)

	cli := h.manager.DockerClient()
	if cli == nil {
		jsonErr(w, http.StatusServiceUnavailable, "docker unavailable")
		return
	}

	entries, err := listContainerDir(r.Context(), cli, containerID, dirPath)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, entries)
}

func (h *containerFilesHandler) downloadFile(w http.ResponseWriter, r *http.Request) {
	containerID := chi.URLParam(r, "id")
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonErr(w, http.StatusBadRequest, "path is required")
		return
	}
	filePath = path.Clean("/" + filePath)

	cli := h.manager.DockerClient()
	if cli == nil {
		jsonErr(w, http.StatusServiceUnavailable, "docker unavailable")
		return
	}

	result, err := cli.CopyFromContainer(r.Context(), containerID, client.CopyFromContainerOptions{SourcePath: filePath})
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer result.Content.Close()

	tr := tar.NewReader(result.Content)
	hdr, err := tr.Next()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "read tar: "+err.Error())
		return
	}

	filename := filepath.Base(hdr.Name)
	ct := mime.TypeByExtension(filepath.Ext(filename))
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if hdr.Size > 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", hdr.Size))
	}
	io.Copy(w, tr) //nolint:errcheck
}

func listContainerDir(ctx context.Context, cli *client.Client, containerID, dirPath string) ([]containerDirEntry, error) {
	result, err := cli.CopyFromContainer(ctx, containerID, client.CopyFromContainerOptions{SourcePath: dirPath})
	if err != nil {
		return nil, err
	}
	defer result.Content.Close()

	var entries []containerDirEntry
	seen := map[string]bool{}
	tr := tar.NewReader(result.Content)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		// Strip the base dir prefix from the path
		name := path.Clean(hdr.Name)
		// The tar from CopyFromContainer includes the dir itself as first entry
		base := path.Base(dirPath)
		name = strings.TrimPrefix(name, base)
		name = strings.TrimPrefix(name, "/")
		if name == "" || name == "." {
			continue
		}
		// Only immediate children (no nested paths)
		if strings.Contains(name, "/") {
			// Get only first path component
			name = strings.SplitN(name, "/", 2)[0]
			if seen[name] {
				continue
			}
			seen[name] = true
			entries = append(entries, containerDirEntry{
				Name:  name,
				IsDir: true,
			})
			continue
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		entries = append(entries, containerDirEntry{
			Name:    name,
			IsDir:   hdr.Typeflag == tar.TypeDir || hdr.Typeflag == tar.TypeSymlink && hdr.FileInfo().IsDir(),
			Size:    hdr.Size,
			Mode:    hdr.FileInfo().Mode().String(),
			ModTime: hdr.ModTime,
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})
	return entries, nil
}

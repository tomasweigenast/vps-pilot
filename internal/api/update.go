package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
)

const (
	githubOwner = "tomasweigenast"
	githubRepo  = "vps-pilot"
	githubAPI   = "https://api.github.com/repos/" + githubOwner + "/" + githubRepo + "/releases/latest"
)

// AppVersion is set at build time via -ldflags "-X github.com/tomasweigenast/vps-pilot/internal/api.AppVersion=v1.2.3"
var AppVersion = "dev"

type updateHandler struct {
	version string
}

type versionResponse struct {
	Version   string `json:"version"`
	GoVersion string `json:"goVersion"`
}

type updateCheckResponse struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	HasUpdate      bool   `json:"hasUpdate"`
	DownloadURL    string `json:"downloadURL"`
	ReleaseURL     string `json:"releaseURL"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name               string `json:"name"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

func (h *updateHandler) getVersion(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, versionResponse{
		Version:   h.version,
		GoVersion: runtime.Version(),
	})
}

func (h *updateHandler) checkUpdate(w http.ResponseWriter, r *http.Request) {
	rel, err := fetchLatestRelease()
	if err != nil {
		serverErr(w, r, "fetch latest release", err)
		return
	}

	hasUpdate := rel.TagName != "" && rel.TagName != h.version && rel.TagName != "dev"

	// Find the right asset for this platform
	downloadURL := findAssetURL(rel)

	jsonOK(w, updateCheckResponse{
		CurrentVersion: h.version,
		LatestVersion:  rel.TagName,
		HasUpdate:      hasUpdate,
		DownloadURL:    downloadURL,
		ReleaseURL:     rel.HTMLURL,
	})
}

func (h *updateHandler) applyUpdate(w http.ResponseWriter, r *http.Request) {
	rel, err := fetchLatestRelease()
	if err != nil {
		serverErr(w, r, "fetch latest release", err)
		return
	}

	downloadURL := findAssetURL(rel)
	if downloadURL == "" {
		jsonErr(w, http.StatusNotFound, fmt.Sprintf("no suitable binary found for %s/%s in release %s", runtime.GOOS, runtime.GOARCH, rel.TagName))
		return
	}

	// Determine current binary path
	exePath, err := os.Executable()
	if err != nil {
		serverErr(w, r, "resolve executable path", err)
		return
	}

	// Download new binary to a temp file
	tmpFile, err := os.CreateTemp("", "vps-pilot-update-*")
	if err != nil {
		serverErr(w, r, "create temp file", err)
		return
	}
	tmpPath := tmpFile.Name()
	defer func() {
		tmpFile.Close()
		os.Remove(tmpPath) // cleanup if we fail before exec
	}()

	resp, err := http.Get(downloadURL) //nolint:gosec
	if err != nil {
		serverErr(w, r, "download update", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		jsonErr(w, http.StatusBadGateway, fmt.Sprintf("download failed: HTTP %d", resp.StatusCode))
		return
	}

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		serverErr(w, r, "write update file", err)
		return
	}
	tmpFile.Close()

	if err := os.Chmod(tmpPath, 0o755); err != nil {
		serverErr(w, r, "chmod update file", err)
		return
	}

	// Atomically replace the binary
	if err := os.Rename(tmpPath, exePath); err != nil {
		serverErr(w, r, "replace binary", err)
		return
	}

	// Respond before restarting
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"message": "update applied, restarting"})

	// Try systemctl restart in background; fall back to exec-restart
	go func() {
		if err := exec.Command("systemctl", "restart", "vps-pilot").Run(); err == nil {
			return
		}
		// exec-restart: replace the running process image
		//nolint:errcheck
		syscall.Exec(exePath, os.Args, os.Environ())
	}()
}

func fetchLatestRelease() (*githubRelease, error) {
	req, _ := http.NewRequest(http.MethodGet, githubAPI, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "vps-pilot/"+AppVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github API request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github API returned HTTP %d", resp.StatusCode)
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode github response: %w", err)
	}
	return &rel, nil
}

func findAssetURL(rel *githubRelease) string {
	// Asset naming pattern: vps-pilot-linux-amd64, vps-pilot-linux-arm64, etc.
	wantSuffix := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	for _, asset := range rel.Assets {
		name := strings.ToLower(asset.Name)
		if strings.HasSuffix(name, wantSuffix) || strings.Contains(name, wantSuffix) {
			return asset.BrowserDownloadURL
		}
	}
	return ""
}

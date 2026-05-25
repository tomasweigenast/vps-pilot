package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"sync"
	"time"
)

const (
	githubOwner = "tomasweigenast"
	githubRepo  = "vps-pilot"
	githubAPI   = "https://api.github.com/repos/" + githubOwner + "/" + githubRepo + "/releases/latest"
)

// AppVersion is set at build time via -ldflags "-X github.com/tomasweigenast/vps-pilot/internal/api.AppVersion=v1.2.3"
var AppVersion = "dev"

// cached update result — written by the background goroutine, read by getUpdateStatus
var (
	cachedUpdateMu     sync.RWMutex
	cachedUpdateResult *updateCheckResponse
)

// StartUpdateChecker launches a background goroutine that fetches the latest GitHub
// release immediately and then once every 24 h. It uses time.Sleep so it consumes
// no resources between checks.
func StartUpdateChecker(version string) {
	go func() {
		check := func() {
			rel, err := fetchLatestRelease()
			if err != nil {
				return
			}
			hasUpdate := rel.TagName != "" && rel.TagName != version && version != "dev"
			result := &updateCheckResponse{
				CurrentVersion: version,
				LatestVersion:  rel.TagName,
				HasUpdate:      hasUpdate,
				ReleaseURL:     rel.HTMLURL,
			}
			cachedUpdateMu.Lock()
			cachedUpdateResult = result
			cachedUpdateMu.Unlock()
		}

		check()
		for {
			time.Sleep(24 * time.Hour)
			check()
		}
	}()
}

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
	ReleaseURL     string `json:"releaseURL"`
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

func (h *updateHandler) getVersion(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, versionResponse{
		Version:   h.version,
		GoVersion: runtime.Version(),
	})
}

// checkUpdate hits GitHub on demand and refreshes the cache.
func (h *updateHandler) checkUpdate(w http.ResponseWriter, r *http.Request) {
	rel, err := fetchLatestRelease()
	if err != nil {
		serverErr(w, r, "fetch latest release", err)
		return
	}

	hasUpdate := rel.TagName != "" && rel.TagName != h.version && h.version != "dev"

	result := &updateCheckResponse{
		CurrentVersion: h.version,
		LatestVersion:  rel.TagName,
		HasUpdate:      hasUpdate,
		ReleaseURL:     rel.HTMLURL,
	}

	cachedUpdateMu.Lock()
	cachedUpdateResult = result
	cachedUpdateMu.Unlock()

	jsonOK(w, result)
}

// getUpdateStatus returns the cached update check result without hitting GitHub.
// Returns an empty/no-update response if no check has completed yet.
func (h *updateHandler) getUpdateStatus(w http.ResponseWriter, r *http.Request) {
	cachedUpdateMu.RLock()
	result := cachedUpdateResult
	cachedUpdateMu.RUnlock()

	if result == nil {
		jsonOK(w, updateCheckResponse{
			CurrentVersion: h.version,
			HasUpdate:      false,
		})
		return
	}
	jsonOK(w, result)
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


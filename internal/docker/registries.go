package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tomasweigenast/vps-pilot/internal/db"
)

// LoginRegistry authenticates with a registry via docker login.
func LoginRegistry(ctx context.Context, url, username, secret string) error {
	cmd := exec.CommandContext(ctx, "docker", "login", url, "--username", username, "--password-stdin")
	cmd.Stdin = strings.NewReader(secret)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker login failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// LogoutRegistry removes stored credentials for a registry.
func LogoutRegistry(ctx context.Context, url string) error {
	cmd := exec.CommandContext(ctx, "docker", "logout", url)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker logout failed: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// ListRegistryTags fetches the list of tags for an image from the registry's v2 API.
// imageRef should be in the form "registry/repo" or "registry/ns/repo" (no tag).
func ListRegistryTags(ctx context.Context, imageRef string, reg *db.Registry) ([]string, error) {
	host, repo := splitRegistryRepo(imageRef, reg.URL)
	base := "https://" + host
	if host == "docker.io" || host == "registry-1.docker.io" {
		base = "https://registry-1.docker.io"
		if !strings.Contains(repo, "/") {
			repo = "library/" + repo
		}
	}

	url := fmt.Sprintf("%s/v2/%s/tags/list", base, repo)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// If we got 401, retry with auth.
	if resp.StatusCode == http.StatusUnauthorized {
		req2, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)

		// Check for Bearer auth challenge first (preferred).
		wwwAuth := resp.Header.Get("Www-Authenticate")
		if strings.HasPrefix(wwwAuth, "Bearer ") {
			token, err := fetchBearerToken(ctx, wwwAuth, reg)
			if err == nil {
				req2.Header.Set("Authorization", "Bearer "+token)
			}
		} else if reg.Username != "" {
			// Fall back to Basic auth only when credentials are available.
			req2.SetBasicAuth(reg.Username, reg.Secret)
		}

		resp2, err := client.Do(req2)
		if err != nil {
			return nil, err
		}
		defer resp2.Body.Close()
		resp = resp2
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("registry tags API returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode tags response: %w", err)
	}
	return result.Tags, nil
}

// doRegistryRequest performs a GET against url, handling 401 with basic auth or Bearer token.
func doRegistryRequest(ctx context.Context, url string, reg *db.Registry) (*http.Response, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == http.StatusUnauthorized {
		resp.Body.Close()
		req2, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)

		wwwAuth := resp.Header.Get("Www-Authenticate")
		if strings.HasPrefix(wwwAuth, "Bearer ") {
			token, err := fetchBearerToken(ctx, wwwAuth, reg)
			if err == nil {
				req2.Header.Set("Authorization", "Bearer "+token)
			}
		} else if reg.Username != "" {
			req2.SetBasicAuth(reg.Username, reg.Secret)
		}

		return client.Do(req2)
	}
	return resp, nil
}

// ListRepositories returns the list of repositories from the registry _catalog endpoint.
// Note: Docker Hub does not support this endpoint publicly; it works on private registries
// that implement the Docker v2 registry API catalog.
func ListRepositories(ctx context.Context, reg *db.Registry) ([]string, error) {
	host := strings.TrimPrefix(reg.URL, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")

	base := "https://" + host
	url := fmt.Sprintf("%s/v2/_catalog?n=100", base)

	resp, err := doRegistryRequest(ctx, url, reg)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("registry catalog API returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Repositories []string `json:"repositories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode catalog response: %w", err)
	}
	return result.Repositories, nil
}

// ListRepoTags fetches tags for a specific repository in a registry.
// repoName is just the repository path (e.g. "myorg/myapp"), without the registry host.
func ListRepoTags(ctx context.Context, repoName string, reg *db.Registry) ([]string, error) {
	host := strings.TrimPrefix(reg.URL, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimSuffix(host, "/")

	base := "https://" + host
	url := fmt.Sprintf("%s/v2/%s/tags/list", base, repoName)

	resp, err := doRegistryRequest(ctx, url, reg)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("registry tags API returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode tags response: %w", err)
	}
	return result.Tags, nil
}

func fetchBearerToken(ctx context.Context, wwwAuth string, reg *db.Registry) (string, error) {
	// Parse: Bearer realm="...",service="...",scope="..."
	params := map[string]string{}
	for _, part := range strings.Split(strings.TrimPrefix(wwwAuth, "Bearer "), ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			params[kv[0]] = strings.Trim(kv[1], `"`)
		}
	}
	realm := params["realm"]
	if realm == "" {
		return "", fmt.Errorf("no realm in Www-Authenticate")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realm, nil)
	if err != nil {
		return "", err
	}
	q := req.URL.Query()
	if s := params["service"]; s != "" {
		q.Set("service", s)
	}
	if s := params["scope"]; s != "" {
		q.Set("scope", s)
	}
	req.URL.RawQuery = q.Encode()
	// Only add Basic auth when credentials are provided; Docker Hub allows anonymous token requests.
	if reg.Username != "" {
		req.SetBasicAuth(reg.Username, reg.Secret)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var tok struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	if tok.Token != "" {
		return tok.Token, nil
	}
	return tok.AccessToken, nil
}

// splitRegistryRepo separates the host from the repo path given a known registry URL.
// e.g. imageRef="ghcr.io/myorg/myapp", registryURL="ghcr.io" → host="ghcr.io", repo="myorg/myapp"
func splitRegistryRepo(imageRef, registryURL string) (host, repo string) {
	registryURL = strings.TrimPrefix(registryURL, "https://")
	registryURL = strings.TrimPrefix(registryURL, "http://")
	registryURL = strings.TrimSuffix(registryURL, "/")

	if strings.HasPrefix(imageRef, registryURL+"/") {
		return registryURL, strings.TrimPrefix(imageRef, registryURL+"/")
	}
	// Docker Hub fallback
	if !strings.Contains(imageRef, "/") || strings.HasPrefix(imageRef, "docker.io/") {
		return "docker.io", strings.TrimPrefix(imageRef, "docker.io/")
	}
	parts := strings.SplitN(imageRef, "/", 2)
	// If first part looks like a hostname (contains a dot or colon), treat it as host.
	if strings.ContainsAny(parts[0], ".:") {
		return parts[0], parts[1]
	}
	return "docker.io", imageRef
}

// semverRe matches vX.Y.Z or X.Y.Z with optional pre-release suffix.
var semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)`)

// dateTagRe matches YYYYMMDD or YYYY-MM-DD.
var dateTagRe = regexp.MustCompile(`^(\d{4})-?(\d{2})-?(\d{2})$`)

// FindNewerTag returns the newest tag from availableTags that is strictly greater
// than currentTag using semver or date-based ordering. Returns "", false if no newer tag found.
func FindNewerTag(currentTag string, availableTags []string) (string, bool) {
	if isSemver(currentTag) {
		return findNewerSemver(currentTag, availableTags)
	}
	if isDateTag(currentTag) {
		return findNewerDate(currentTag, availableTags)
	}
	return "", false
}

func isSemver(tag string) bool {
	return semverRe.MatchString(tag)
}

func isDateTag(tag string) bool {
	return dateTagRe.MatchString(tag)
}

type semverTuple struct {
	major, minor, patch int
	original            string
}

func parseSemver(tag string) (semverTuple, bool) {
	m := semverRe.FindStringSubmatch(tag)
	if m == nil {
		return semverTuple{}, false
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	return semverTuple{major, minor, patch, tag}, true
}

func (a semverTuple) gt(b semverTuple) bool {
	if a.major != b.major {
		return a.major > b.major
	}
	if a.minor != b.minor {
		return a.minor > b.minor
	}
	return a.patch > b.patch
}

func findNewerSemver(currentTag string, tags []string) (string, bool) {
	cur, ok := parseSemver(currentTag)
	if !ok {
		return "", false
	}
	best := cur
	for _, t := range tags {
		if t == currentTag {
			continue
		}
		// Only compare tags with same prefix style (v vs no-v).
		hasV := strings.HasPrefix(t, "v")
		curHasV := strings.HasPrefix(currentTag, "v")
		if hasV != curHasV {
			continue
		}
		cand, ok := parseSemver(t)
		if !ok {
			continue
		}
		if cand.gt(best) {
			best = cand
		}
	}
	if best.original == currentTag {
		return "", false
	}
	return best.original, true
}

func findNewerDate(currentTag string, tags []string) (string, bool) {
	cur := normalizeDateTag(currentTag)
	best := cur
	bestOrig := currentTag
	for _, t := range tags {
		if t == currentTag {
			continue
		}
		if !isDateTag(t) {
			continue
		}
		norm := normalizeDateTag(t)
		if norm > best {
			best = norm
			bestOrig = t
		}
	}
	if bestOrig == currentTag {
		return "", false
	}
	return bestOrig, true
}

// normalizeDateTag strips hyphens so YYYY-MM-DD and YYYYMMDD compare equally.
func normalizeDateTag(tag string) string {
	return strings.ReplaceAll(tag, "-", "")
}

// CompareTags returns a positive int if a > b, negative if a < b, 0 if equal.
// Semver tags rank highest, then date tags, then everything else lexicographically.
func CompareTags(a, b string) int {
	aSemver, aOk := parseSemver(a)
	bSemver, bOk := parseSemver(b)
	if aOk && bOk {
		if aSemver.gt(bSemver) {
			return 1
		}
		if bSemver.gt(aSemver) {
			return -1
		}
		return 0
	}
	if aOk {
		return 1
	}
	if bOk {
		return -1
	}
	// Both date or plain strings.
	aDate := isDateTag(a)
	bDate := isDateTag(b)
	if aDate && bDate {
		aN := normalizeDateTag(a)
		bN := normalizeDateTag(b)
		if aN > bN {
			return 1
		}
		if aN < bN {
			return -1
		}
		return 0
	}
	if aDate {
		return 1
	}
	if bDate {
		return -1
	}
	// Lexicographic fallback (descending means b < a).
	if a > b {
		return 1
	}
	if a < b {
		return -1
	}
	return 0
}

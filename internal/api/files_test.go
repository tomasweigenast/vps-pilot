package api_test

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFilesList_ListsEntries(t *testing.T) {
	srv, database, dir := newTestServer(t)
	// view_files requires the global permission; use an admin to bypass that.
	password := createTestAdmin(t, database, "filesuser")
	client := loginAs(t, srv, "filesuser", password)

	// Create test files in the FilesRootDir (same as temp dir)
	os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hi"), 0o644)
	os.Mkdir(filepath.Join(dir, "mydir"), 0o755)

	resp, err := client.Get(srv.URL + "/api/files?path=/")
	if err != nil {
		t.Fatalf("GET /api/files: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "hello.txt") {
		t.Error("expected hello.txt in file listing")
	}
}

func TestFilesDownload(t *testing.T) {
	srv, database, dir := newTestServer(t)
	password := createTestAdmin(t, database, "dluser")
	client := loginAs(t, srv, "dluser", password)

	content := []byte("file content here")
	os.WriteFile(filepath.Join(dir, "download.txt"), content, 0o644)

	resp, err := client.Get(srv.URL + "/files/download?path=/download.txt")
	if err != nil {
		t.Fatalf("GET /files/download: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != string(content) {
		t.Errorf("body mismatch: got %q, want %q", body, content)
	}
}

func TestFilesTraversal_Blocked(t *testing.T) {
	srv, database, _ := newTestServer(t)
	password := createTestAdmin(t, database, "travuser")
	client := loginAs(t, srv, "travuser", password)

	// Try to escape the root
	escapedPath := url.QueryEscape("../../etc")
	resp, err := client.Get(srv.URL + "/api/files?path=" + escapedPath)
	if err != nil {
		t.Fatalf("GET /api/files traversal: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		t.Error("expected non-200 for traversal attempt")
	}
}

func TestFilesUnauthenticated(t *testing.T) {
	srv, _, _ := newTestServer(t)

	resp, err := http.Get(srv.URL + "/api/files?path=/")
	if err != nil {
		t.Fatalf("GET /api/files: %v", err)
	}
	resp.Body.Close()
	// Unauthenticated API requests return 401 (not a redirect).
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated, got %d", resp.StatusCode)
	}
}

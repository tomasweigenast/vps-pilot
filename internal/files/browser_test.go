package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestList_Basic(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello"), 0o644)
	os.WriteFile(filepath.Join(dir, "readme.md"), []byte("readme"), 0o644)
	os.Mkdir(filepath.Join(dir, "subdir"), 0o755)

	b := NewBrowser(dir)
	entries, err := b.List("/")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(entries))
	}

	names := map[string]bool{}
	for _, e := range entries {
		names[e.Name] = true
	}
	for _, want := range []string{"file.txt", "readme.md", "subdir"} {
		if !names[want] {
			t.Errorf("expected entry %q", want)
		}
	}
}

func TestList_Traversal(t *testing.T) {
	dir := t.TempDir()
	b := NewBrowser(dir)
	_, err := b.List("../../etc")
	if err != ErrForbidden {
		t.Errorf("expected ErrForbidden, got %v", err)
	}
}

func TestList_Subdirectory(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "sub")
	os.Mkdir(sub, 0o755)
	os.WriteFile(filepath.Join(sub, "inner.txt"), []byte("x"), 0o644)

	b := NewBrowser(dir)
	entries, err := b.List("/sub")
	if err != nil {
		t.Fatalf("List sub: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "inner.txt" {
		t.Errorf("unexpected entries: %+v", entries)
	}
}

func TestAbsPath_Within(t *testing.T) {
	dir := t.TempDir()
	b := NewBrowser(dir)
	abs, err := b.AbsPath("/sub/file.txt")
	if err != nil {
		t.Fatalf("AbsPath: %v", err)
	}
	expected := filepath.Join(dir, "sub", "file.txt")
	if abs != expected {
		t.Errorf("expected %q, got %q", expected, abs)
	}
}

func TestAbsPath_Outside(t *testing.T) {
	dir := t.TempDir()
	b := NewBrowser(dir)
	_, err := b.AbsPath("../../etc/passwd")
	if err != ErrForbidden {
		t.Errorf("expected ErrForbidden, got %v", err)
	}
}

func TestAbsPath_Root(t *testing.T) {
	dir := t.TempDir()
	b := NewBrowser(dir)
	abs, err := b.AbsPath("/")
	if err != nil {
		t.Fatalf("AbsPath root: %v", err)
	}
	if abs != dir {
		t.Errorf("expected %q, got %q", dir, abs)
	}
}

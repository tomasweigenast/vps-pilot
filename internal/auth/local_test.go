package auth

import (
	"strings"
	"testing"
)

func TestHashPassword_Format(t *testing.T) {
	hash, err := HashPassword("secret123")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("expected $argon2id$ prefix, got %q", hash[:10])
	}
}

func TestHashPassword_Unique(t *testing.T) {
	h1, _ := HashPassword("same")
	h2, _ := HashPassword("same")
	if h1 == h2 {
		t.Error("two hashes of same password should differ (random salt)")
	}
}

func TestVerifyPassword_Correct(t *testing.T) {
	hash, _ := HashPassword("mypassword")
	ok, err := VerifyPassword("mypassword", hash)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Error("expected correct password to verify")
	}
}

func TestVerifyPassword_Wrong(t *testing.T) {
	hash, _ := HashPassword("mypassword")
	ok, err := VerifyPassword("wrongpassword", hash)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if ok {
		t.Error("expected wrong password to not verify")
	}
}

func TestVerifyPassword_Malformed(t *testing.T) {
	_, err := VerifyPassword("anything", "notahash")
	if err == nil {
		t.Error("expected error for malformed hash")
	}
}

func TestVerifyPassword_EmptyHash(t *testing.T) {
	_, err := VerifyPassword("anything", "")
	if err == nil {
		t.Error("expected error for empty hash")
	}
}

func TestVerifyPassword_BadParams(t *testing.T) {
	// valid structure but garbage params
	_, err := VerifyPassword("x", "$argon2id$v=19$GARBAGE$salt$hash")
	if err == nil {
		t.Error("expected error for bad params")
	}
}

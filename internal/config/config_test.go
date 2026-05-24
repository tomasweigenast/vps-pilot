package config

import (
	"os"
	"testing"
)

func setEnv(t *testing.T, key, value string) {
	t.Helper()
	t.Setenv(key, value)
}

const validSecret = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

// loadFromEnv is a test helper that loads config without a file (env-vars only).
func loadFromEnv() (*Config, error) {
	return Load("") // empty path → no file, env vars + defaults only
}

func TestLoad_MissingSecret(t *testing.T) {
	t.Setenv("COOKIE_SECRET", "")
	_, err := loadFromEnv()
	if err == nil {
		t.Error("expected error for missing secret")
	}
}

func TestLoad_InvalidHex(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", "xxxxxx")
	_, err := loadFromEnv()
	if err == nil {
		t.Error("expected error for invalid hex")
	}
}

func TestLoad_ShortSecret(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", "deadbeef") // only 4 bytes
	_, err := loadFromEnv()
	if err == nil {
		t.Error("expected error for short secret")
	}
}

func TestLoad_Defaults(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", validSecret)
	t.Setenv("AUTH_MODE", "")
	t.Setenv("LISTEN_ADDR", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("PROJECTS_DIR", "")
	t.Setenv("FILES_ROOT", "")

	cfg, err := loadFromEnv()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModeBoth {
		t.Errorf("default AuthMode: got %q, want %q", cfg.AuthMode, AuthModeBoth)
	}
	if cfg.ListenAddr != "0.0.0.0:8080" {
		t.Errorf("default ListenAddr: got %q", cfg.ListenAddr)
	}
	if cfg.DataDir != "/var/lib/vps-pilot" {
		t.Errorf("default DataDir: got %q", cfg.DataDir)
	}
}

func TestLoad_AuthModePAM(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", validSecret)
	setEnv(t, "AUTH_MODE", "pam")
	cfg, err := loadFromEnv()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModePAM {
		t.Errorf("expected pam, got %q", cfg.AuthMode)
	}
}

func TestLoad_AuthModeLocal(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", validSecret)
	setEnv(t, "AUTH_MODE", "local")
	cfg, err := loadFromEnv()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.AuthMode != AuthModeLocal {
		t.Errorf("expected local, got %q", cfg.AuthMode)
	}
}

func TestLoad_AuthModeInvalid(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", validSecret)
	setEnv(t, "AUTH_MODE", "bogus")
	_, err := loadFromEnv()
	if err == nil {
		t.Error("expected error for invalid auth mode")
	}
}

func TestLoad_SecretLength(t *testing.T) {
	setEnv(t, "COOKIE_SECRET", validSecret)
	cfg, err := loadFromEnv()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(cfg.CookieSecret) != 32 {
		t.Errorf("expected 32 byte secret, got %d", len(cfg.CookieSecret))
	}
}

func TestLoad_FromTOMLFile(t *testing.T) {
	f := t.TempDir() + "/config.toml"
	if err := os.WriteFile(f, []byte(DefaultConfigContent(ConfigDefaults{CookieSecret: validSecret})), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	t.Setenv("COOKIE_SECRET", "") // ensure env doesn't interfere

	cfg, err := Load(f)
	if err != nil {
		t.Fatalf("Load from file: %v", err)
	}
	if len(cfg.CookieSecret) != 32 {
		t.Errorf("expected 32 byte secret from file, got %d", len(cfg.CookieSecret))
	}
	if cfg.AuthMode != AuthModeBoth {
		t.Errorf("expected both, got %q", cfg.AuthMode)
	}
}

func TestLoad_EnvOverridesFile(t *testing.T) {
	f := t.TempDir() + "/config.toml"
	if err := os.WriteFile(f, []byte(DefaultConfigContent(ConfigDefaults{CookieSecret: validSecret})), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	t.Setenv("COOKIE_SECRET", "")
	t.Setenv("LISTEN_ADDR", "127.0.0.1:9999")
	defer t.Setenv("LISTEN_ADDR", "")

	cfg, err := Load(f)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ListenAddr != "127.0.0.1:9999" {
		t.Errorf("env override failed: got %q, want 127.0.0.1:9999", cfg.ListenAddr)
	}
}

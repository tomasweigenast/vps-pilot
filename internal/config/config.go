package config

import (
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

type AuthMode string

const (
	AuthModePAM   AuthMode = "pam"
	AuthModeLocal AuthMode = "local"
	AuthModeBoth  AuthMode = "both"
)

type Config struct {
	ListenAddr   string
	DataDir      string
	CookieSecret []byte
	AuthMode     AuthMode
	ProjectsDir  string
	FilesRootDir string
	TLSCert      string
	TLSKey       string
	LogSink      string
	// SecureCookies marks all cookies as Secure (HTTPS-only).
	// Set automatically when TLSCert is provided.
	SecureCookies bool
	// SkipCSRF disables CSRF protection. Only set in tests.
	SkipCSRF bool
}

func Load() (*Config, error) {
	secret := os.Getenv("COOKIE_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("COOKIE_SECRET env var required (32 random hex bytes)")
	}
	secretBytes, err := hex.DecodeString(secret)
	if err != nil || len(secretBytes) < 32 {
		return nil, fmt.Errorf("COOKIE_SECRET must be a valid 32-byte hex string")
	}

	authMode := AuthMode(strings.ToLower(env("AUTH_MODE", "both")))
	if authMode != AuthModePAM && authMode != AuthModeLocal && authMode != AuthModeBoth {
		return nil, fmt.Errorf("AUTH_MODE must be pam, local, or both")
	}

	tlsCert := os.Getenv("TLS_CERT")
	return &Config{
		ListenAddr:    env("LISTEN_ADDR", "0.0.0.0:8080"),
		DataDir:       env("DATA_DIR", "/var/lib/vps-manager"),
		CookieSecret:  secretBytes,
		AuthMode:      authMode,
		ProjectsDir:   env("PROJECTS_DIR", "/opt/projects"),
		FilesRootDir:  env("FILES_ROOT", "/"),
		TLSCert:       tlsCert,
		TLSKey:        os.Getenv("TLS_KEY"),
		LogSink:       env("LOG_SINK", "memory"),
		SecureCookies: tlsCert != "",
	}, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

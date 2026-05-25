package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
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
	LogLevel     string
	// MetricsInterval is how often metrics snapshots are recorded to the DB.
	MetricsInterval time.Duration
	// MetricsRetention is how long metrics snapshots are kept.
	MetricsRetention time.Duration
	// SecureCookies marks all cookies as Secure (HTTPS-only).
	// Set automatically when TLSCert is provided.
	SecureCookies bool
	// SkipCSRF disables CSRF protection. Only set in tests.
	SkipCSRF bool
	// ConfigPath is the path to the TOML config file that was loaded.
	// Empty when config was loaded entirely from env/defaults.
	ConfigPath string
}

// fileConfig is the TOML-decoded representation of the config file.
// All fields are strings so absent fields stay empty (defaults applied later).
type fileConfig struct {
	CookieSecret     string `toml:"cookie_secret"`
	AuthMode         string `toml:"auth_mode"`
	ListenAddr       string `toml:"listen_addr"`
	DataDir          string `toml:"data_dir"`
	ProjectsDir      string `toml:"projects_dir"`
	FilesRoot        string `toml:"files_root"`
	TLSCert          string `toml:"tls_cert"`
	TLSKey           string `toml:"tls_key"`
	LogSink          string `toml:"log_sink"`
	LogLevel         string `toml:"log_level"`
	MetricsInterval  string `toml:"metrics_interval"`
	MetricsRetention string `toml:"metrics_retention"`
}

// Load reads configuration from cfgPath (TOML), then applies any non-empty
// environment variable overrides, and finally fills in hardcoded defaults.
//
// If cfgPath does not exist, Load proceeds with an empty file config so that
// env vars and defaults alone are sufficient (useful in tests / CI).
// If cfgPath exists but is malformed, Load returns an error immediately.
func Load(cfgPath string) (*Config, error) {
	var fc fileConfig
	if cfgPath != "" {
		if _, err := os.Stat(cfgPath); err == nil {
			if _, err := toml.DecodeFile(cfgPath, &fc); err != nil {
				return nil, fmt.Errorf("parse config file %s: %w", cfgPath, err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("stat config file %s: %w", cfgPath, err)
		}
	}

	// Env vars override file values (non-empty env wins).
	fc.CookieSecret = envOr(fc.CookieSecret, "COOKIE_SECRET")
	fc.AuthMode = envOr(fc.AuthMode, "AUTH_MODE")
	fc.ListenAddr = envOr(fc.ListenAddr, "LISTEN_ADDR")
	fc.DataDir = envOr(fc.DataDir, "DATA_DIR")
	fc.ProjectsDir = envOr(fc.ProjectsDir, "PROJECTS_DIR")
	fc.FilesRoot = envOr(fc.FilesRoot, "FILES_ROOT")
	fc.TLSCert = envOr(fc.TLSCert, "TLS_CERT")
	fc.TLSKey = envOr(fc.TLSKey, "TLS_KEY")
	fc.LogSink = envOr(fc.LogSink, "LOG_SINK")
	fc.LogLevel = envOr(fc.LogLevel, "LOG_LEVEL")
	fc.MetricsInterval = envOr(fc.MetricsInterval, "METRICS_INTERVAL")
	fc.MetricsRetention = envOr(fc.MetricsRetention, "METRICS_RETENTION")

	// Apply defaults for still-empty fields.
	if fc.AuthMode == "" {
		fc.AuthMode = "both"
	}
	if fc.ListenAddr == "" {
		fc.ListenAddr = "0.0.0.0:8080"
	}
	if fc.DataDir == "" {
		fc.DataDir = "/var/lib/vps-pilot"
	}
	if fc.ProjectsDir == "" {
		fc.ProjectsDir = "/opt/projects"
	}
	if fc.FilesRoot == "" {
		fc.FilesRoot = "/"
	}
	if fc.LogSink == "" {
		fc.LogSink = "both"
	}
	if fc.LogLevel == "" {
		fc.LogLevel = "info"
	}
	if fc.MetricsInterval == "" {
		fc.MetricsInterval = "30s"
	}
	if fc.MetricsRetention == "" {
		fc.MetricsRetention = "168h" // 7 days
	}

	// Parse metrics durations.
	metricsInterval, err := time.ParseDuration(fc.MetricsInterval)
	if err != nil || metricsInterval < time.Second {
		return nil, fmt.Errorf("metrics_interval must be a valid duration >= 1s (e.g. \"30s\", \"1m\"): %q", fc.MetricsInterval)
	}
	metricsRetention, err := time.ParseDuration(fc.MetricsRetention)
	if err != nil || metricsRetention < time.Minute {
		return nil, fmt.Errorf("metrics_retention must be a valid duration >= 1m (e.g. \"168h\", \"30d\" is not valid — use hours): %q", fc.MetricsRetention)
	}

	// Validate cookie_secret.
	if fc.CookieSecret == "" {
		return nil, fmt.Errorf("cookie_secret is required (set it in the config file or via COOKIE_SECRET env var)")
	}
	secretBytes, err := hex.DecodeString(fc.CookieSecret)
	if err != nil || len(secretBytes) < 32 {
		return nil, fmt.Errorf("cookie_secret must be a valid hex string of at least 32 bytes (64 hex chars)")
	}

	// Validate auth_mode.
	authMode := AuthMode(strings.ToLower(fc.AuthMode))
	if authMode != AuthModePAM && authMode != AuthModeLocal && authMode != AuthModeBoth {
		return nil, fmt.Errorf("auth_mode must be one of: pam, local, both")
	}

	return &Config{
		ListenAddr:       fc.ListenAddr,
		DataDir:          fc.DataDir,
		CookieSecret:     secretBytes,
		AuthMode:         authMode,
		ProjectsDir:      fc.ProjectsDir,
		FilesRootDir:     fc.FilesRoot,
		TLSCert:          fc.TLSCert,
		TLSKey:           fc.TLSKey,
		LogSink:          fc.LogSink,
		LogLevel:         strings.ToLower(fc.LogLevel),
		MetricsInterval:  metricsInterval,
		MetricsRetention: metricsRetention,
		SecureCookies:    fc.TLSCert != "",
		ConfigPath:       cfgPath,
	}, nil
}

// GenerateCookieSecret returns a cryptographically random 32-byte hex string
// suitable for use as cookie_secret.
func GenerateCookieSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate cookie secret: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ConfigDefaults holds the values used to render the default config file.
// Any empty field falls back to the hardcoded default shown in the comments.
type ConfigDefaults struct {
	CookieSecret     string // required; use GenerateCookieSecret()
	ListenAddr       string // default: 0.0.0.0:8080
	DataDir          string // default: /var/lib/vps-pilot
	ProjectsDir      string // default: /opt/projects
	FilesRoot        string // default: /
	AuthMode         string // default: both
	TLSCert          string // default: ""
	TLSKey           string // default: ""
	LogSink          string // default: both
	LogLevel         string // default: info
	MetricsInterval  string // default: 30s
	MetricsRetention string // default: 168h
}

func (d *ConfigDefaults) applyDefaults() {
	if d.ListenAddr == "" {
		d.ListenAddr = "0.0.0.0:8080"
	}
	if d.DataDir == "" {
		d.DataDir = "/var/lib/vps-pilot"
	}
	if d.ProjectsDir == "" {
		d.ProjectsDir = "/opt/projects"
	}
	if d.FilesRoot == "" {
		d.FilesRoot = "/"
	}
	if d.AuthMode == "" {
		d.AuthMode = "both"
	}
	if d.LogSink == "" {
		d.LogSink = "both"
	}
	if d.LogLevel == "" {
		d.LogLevel = "info"
	}
	if d.MetricsInterval == "" {
		d.MetricsInterval = "30s"
	}
	if d.MetricsRetention == "" {
		d.MetricsRetention = "168h"
	}
}

// DefaultConfigContent returns a fully-commented TOML config template rendered
// with the provided defaults. Empty fields in d use hardcoded defaults.
func DefaultConfigContent(d ConfigDefaults) string {
	d.applyDefaults()
	return fmt.Sprintf(`# vps-pilot configuration file
# Edit this file and restart the service to apply changes.
# Environment variables override individual settings (useful in CI/testing).
# See: https://github.com/tomasweigenast/vps-pilot

# cookie_secret: Required. 64-char hex-encoded 32-byte random value used to
# sign and encrypt session cookies. Changing this invalidates all sessions.
# Env override: COOKIE_SECRET
cookie_secret = %q

# auth_mode: Authentication backend. Options: "pam", "local", "both".
# pam   - authenticate against Linux system users via PAM
# local - authenticate against users stored in SQLite (created with: vps-pilot adduser)
# both  - try PAM first, fall back to local (default)
# Env override: AUTH_MODE
auth_mode = %q

# listen_addr: Address and port the HTTP server binds to.
# Env override: LISTEN_ADDR
listen_addr = %q

# data_dir: Directory for the SQLite database and internal state.
# Env override: DATA_DIR
data_dir = %q

# projects_dir: Root directory where Docker Compose projects live.
# Each subdirectory containing a compose file is treated as a project.
# Env override: PROJECTS_DIR
projects_dir = %q

# files_root: Root directory exposed by the file browser.
# Users cannot browse above this path.
# Env override: FILES_ROOT
files_root = %q

# tls_cert / tls_key: Paths to TLS certificate and key files.
# When set, the server serves HTTPS directly and marks session cookies Secure.
# Leave empty to run plain HTTP (recommended: terminate TLS at nginx/caddy).
# Env overrides: TLS_CERT, TLS_KEY
tls_cert = %q
tls_key  = %q

# log_sink: Where to write application logs.
# Options: "stdout", "db", "both" (default)
# Env override: LOG_SINK
log_sink = %q

# log_level: Minimum log level to emit.
# Options: "debug", "info", "warn", "error"
# Env override: LOG_LEVEL
log_level = %q

# metrics_interval: How often a metrics snapshot is recorded to the database.
# Use Go duration syntax: "15s", "30s", "1m", "5m". Minimum: 1s.
# Env override: METRICS_INTERVAL
metrics_interval = %q

# metrics_retention: How long metrics snapshots are kept before being purged.
# Use Go duration syntax in hours: "24h", "168h" (7 days), "720h" (30 days).
# Env override: METRICS_RETENTION
metrics_retention = %q
`,
		d.CookieSecret,
		d.AuthMode,
		d.ListenAddr,
		d.DataDir,
		d.ProjectsDir,
		d.FilesRoot,
		d.TLSCert,
		d.TLSKey,
		d.LogSink,
		d.LogLevel,
		d.MetricsInterval,
		d.MetricsRetention,
	)
}

// envOr returns the environment variable value if non-empty, otherwise current.
func envOr(current, envKey string) string {
	if v := os.Getenv(envKey); v != "" {
		return v
	}
	return current
}

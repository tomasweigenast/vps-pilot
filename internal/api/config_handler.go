package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/tomasweigenast/vps-pilot/internal/config"
)

type configAPIHandler struct {
	cfg      *config.Config
	reloader *Reloader
}

// configView is the JSON-safe view of the config (never includes cookie_secret).
type configView struct {
	ListenAddr       string `json:"listenAddr"`
	AuthMode         string `json:"authMode"`
	ProjectsDir      string `json:"projectsDir"`
	FilesRoot        string `json:"filesRoot"`
	TLSCert          string `json:"tlsCert"`
	TLSKey           string `json:"tlsKey"`
	LogSink          string `json:"logSink"`
	LogLevel         string `json:"logLevel"`
	MetricsInterval  string `json:"metricsInterval"`
	MetricsRetention string `json:"metricsRetention"`
	// ReadOnly fields (cannot be changed via UI but shown for context)
	DataDir    string `json:"dataDir"`
	ConfigPath string `json:"configPath"` // empty if loaded from env/defaults
}

func (h *configAPIHandler) getConfig(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, h.buildView())
}

func (h *configAPIHandler) buildView() configView {
	return configView{
		ListenAddr:       h.cfg.ListenAddr,
		AuthMode:         string(h.cfg.AuthMode),
		ProjectsDir:      h.cfg.ProjectsDir,
		FilesRoot:        h.cfg.FilesRootDir,
		TLSCert:          h.cfg.TLSCert,
		TLSKey:           h.cfg.TLSKey,
		LogSink:          h.cfg.LogSink,
		LogLevel:         h.cfg.LogLevel,
		MetricsInterval:  h.cfg.MetricsInterval.String(),
		MetricsRetention: h.cfg.MetricsRetention.String(),
		DataDir:          h.cfg.DataDir,
		ConfigPath:       h.cfg.ConfigPath,
	}
}

type configUpdateRequest struct {
	ListenAddr       *string `json:"listenAddr"`
	AuthMode         *string `json:"authMode"`
	ProjectsDir      *string `json:"projectsDir"`
	FilesRoot        *string `json:"filesRoot"`
	TLSCert          *string `json:"tlsCert"`
	TLSKey           *string `json:"tlsKey"`
	LogSink          *string `json:"logSink"`
	LogLevel         *string `json:"logLevel"`
	MetricsInterval  *string `json:"metricsInterval"`
	MetricsRetention *string `json:"metricsRetention"`
}

func (h *configAPIHandler) updateConfig(w http.ResponseWriter, r *http.Request) {
	if h.cfg.ConfigPath == "" {
		jsonErr(w, http.StatusNotFound, "no config file — server was started with environment variables or defaults only; create a config file to enable editing")
		return
	}

	var req configUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Load current file config as the base
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

	var fc fileConfig
	if _, err := toml.DecodeFile(h.cfg.ConfigPath, &fc); err != nil && !os.IsNotExist(err) {
		serverErr(w, r, "read config file", err)
		return
	}

	// Apply only the fields the caller sent
	if req.ListenAddr != nil {
		fc.ListenAddr = *req.ListenAddr
	}
	if req.AuthMode != nil {
		mode := strings.ToLower(*req.AuthMode)
		if mode != "pam" && mode != "local" && mode != "both" {
			jsonErr(w, http.StatusBadRequest, "authMode must be one of: pam, local, both")
			return
		}
		fc.AuthMode = mode
	}
	if req.ProjectsDir != nil {
		fc.ProjectsDir = *req.ProjectsDir
	}
	if req.FilesRoot != nil {
		fc.FilesRoot = *req.FilesRoot
	}
	if req.TLSCert != nil {
		fc.TLSCert = *req.TLSCert
	}
	if req.TLSKey != nil {
		fc.TLSKey = *req.TLSKey
	}
	if req.LogSink != nil {
		sink := strings.ToLower(*req.LogSink)
		if sink != "stdout" && sink != "db" && sink != "both" {
			jsonErr(w, http.StatusBadRequest, "logSink must be one of: stdout, db, both")
			return
		}
		fc.LogSink = sink
	}
	if req.LogLevel != nil {
		level := strings.ToLower(*req.LogLevel)
		if level != "debug" && level != "info" && level != "warn" && level != "error" {
			jsonErr(w, http.StatusBadRequest, "logLevel must be one of: debug, info, warn, error")
			return
		}
		fc.LogLevel = level
	}
	if req.MetricsInterval != nil {
		d, err := time.ParseDuration(*req.MetricsInterval)
		if err != nil || d < time.Second {
			jsonErr(w, http.StatusBadRequest, fmt.Sprintf("metricsInterval must be a valid duration >= 1s: %q", *req.MetricsInterval))
			return
		}
		fc.MetricsInterval = *req.MetricsInterval
	}
	if req.MetricsRetention != nil {
		d, err := time.ParseDuration(*req.MetricsRetention)
		if err != nil || d < time.Minute {
			jsonErr(w, http.StatusBadRequest, fmt.Sprintf("metricsRetention must be a valid duration >= 1m: %q", *req.MetricsRetention))
			return
		}
		fc.MetricsRetention = *req.MetricsRetention
	}

	// Apply defaults for still-empty fields (preserve existing cookie_secret)
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
		fc.MetricsRetention = "168h"
	}

	// Write back using the DefaultConfigContent template (preserves comments)
	content := config.DefaultConfigContent(config.ConfigDefaults{
		CookieSecret:     fc.CookieSecret,
		AuthMode:         fc.AuthMode,
		ListenAddr:       fc.ListenAddr,
		DataDir:          fc.DataDir,
		ProjectsDir:      fc.ProjectsDir,
		FilesRoot:        fc.FilesRoot,
		TLSCert:          fc.TLSCert,
		TLSKey:           fc.TLSKey,
		LogSink:          fc.LogSink,
		LogLevel:         fc.LogLevel,
		MetricsInterval:  fc.MetricsInterval,
		MetricsRetention: fc.MetricsRetention,
	})

	if err := os.WriteFile(h.cfg.ConfigPath, []byte(content), 0o600); err != nil {
		serverErr(w, r, "write config file", err)
		return
	}

	// Build a new Config from the saved values so we can diff and hot-reload.
	newCfg, err := config.Load(h.cfg.ConfigPath)
	if err != nil {
		// Config saved OK but reload failed — not fatal, just warn.
		slog.Warn("config saved but reload failed", "err", err)
		jsonOK(w, map[string]any{
			"message":        "config saved",
			"requiresRestart": true,
			"restartFields":  []string{},
		})
		return
	}

	var restartFields []string
	if h.reloader != nil {
		restartFields = h.reloader.Apply(h.cfg, newCfg)
		// Update in-memory config pointer fields that are safe to change.
		h.cfg.LogLevel = newCfg.LogLevel
		h.cfg.LogSink = newCfg.LogSink
		h.cfg.AuthMode = newCfg.AuthMode
		h.cfg.ProjectsDir = newCfg.ProjectsDir
		h.cfg.FilesRootDir = newCfg.FilesRootDir
		h.cfg.MetricsInterval = newCfg.MetricsInterval
		h.cfg.MetricsRetention = newCfg.MetricsRetention
		h.cfg.ListenAddr = newCfg.ListenAddr
		h.cfg.DataDir = newCfg.DataDir
		h.cfg.TLSCert = newCfg.TLSCert
		h.cfg.TLSKey = newCfg.TLSKey
	}

	jsonOK(w, map[string]any{
		"message":        "config saved",
		"requiresRestart": len(restartFields) > 0,
		"restartFields":  restartFields,
	})
}

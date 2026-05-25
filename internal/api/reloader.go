package api

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/tomasweigenast/vps-pilot/internal/config"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
	"github.com/tomasweigenast/vps-pilot/internal/files"
	"github.com/tomasweigenast/vps-pilot/internal/logbuffer"
	"github.com/tomasweigenast/vps-pilot/internal/metrics"
)

// Reloader holds references to live components that can be updated at runtime
// when the config file is saved via the API.
type Reloader struct {
	LogHandler *logbuffer.Handler
	LogBuf     *logbuffer.RingBuffer
	LogDB      *sql.DB

	AuthHandler *authHandler
	DockerMgr   *docker.Manager
	FilesBrowser *files.Browser

	// MetricsCancel cancels the current metrics recorder goroutine so it can be
	// restarted with updated interval/retention values.
	MetricsCancel      context.CancelFunc
	MetricsParentCtx   context.Context
	MetricsDB          *sql.DB
}

// Apply hot-reloads every field in newCfg that supports it, and returns the
// list of JSON field names that still require a restart.
func (rl *Reloader) Apply(oldCfg, newCfg *config.Config) []string {
	var needRestart []string

	// log_level — update LevelVar directly (zero-downtime)
	if oldCfg.LogLevel != newCfg.LogLevel {
		var lvl slog.Level
		if err := lvl.UnmarshalText([]byte(newCfg.LogLevel)); err != nil {
			lvl = slog.LevelInfo
		}
		rl.LogHandler.SetLevel(lvl)
		slog.Info("log level changed", "level", newCfg.LogLevel)
	}

	// log_sink — recreate global slog handler
	if oldCfg.LogSink != newCfg.LogSink {
		rl.LogHandler.SetSink(logbuffer.Sink(newCfg.LogSink))
		slog.Info("log sink changed", "sink", newCfg.LogSink)
	}

	// auth_mode
	if oldCfg.AuthMode != newCfg.AuthMode {
		rl.AuthHandler.SetAuthMode(newCfg.AuthMode)
		slog.Info("auth mode changed", "mode", newCfg.AuthMode)
	}

	// projects_dir
	if oldCfg.ProjectsDir != newCfg.ProjectsDir {
		rl.DockerMgr.SetProjectsDir(newCfg.ProjectsDir)
		slog.Info("projects dir changed", "dir", newCfg.ProjectsDir)
	}

	// files_root
	if oldCfg.FilesRootDir != newCfg.FilesRootDir {
		rl.FilesBrowser.SetRoot(newCfg.FilesRootDir)
		slog.Info("files root changed", "root", newCfg.FilesRootDir)
	}

	// metrics_interval or metrics_retention — restart the recorder goroutine
	if oldCfg.MetricsInterval != newCfg.MetricsInterval || oldCfg.MetricsRetention != newCfg.MetricsRetention {
		rl.MetricsCancel() // stop old goroutine
		ctx, cancel := context.WithCancel(rl.MetricsParentCtx)
		rl.MetricsCancel = cancel
		metrics.StartMetricsRecorder(ctx, rl.MetricsDB, newCfg.MetricsInterval, newCfg.MetricsRetention)
		slog.Info("metrics recorder restarted",
			"interval", newCfg.MetricsInterval,
			"retention", newCfg.MetricsRetention)
	}

	// Fields that require restart
	if oldCfg.ListenAddr != newCfg.ListenAddr {
		needRestart = append(needRestart, "listenAddr")
	}
	if oldCfg.DataDir != newCfg.DataDir {
		needRestart = append(needRestart, "dataDir")
	}
	if oldCfg.TLSCert != newCfg.TLSCert || oldCfg.TLSKey != newCfg.TLSKey {
		needRestart = append(needRestart, "tlsCert", "tlsKey")
	}

	return needRestart
}


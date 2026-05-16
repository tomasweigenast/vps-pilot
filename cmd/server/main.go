package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tomasweigenast/vps-manager/internal/api"
	"github.com/tomasweigenast/vps-manager/internal/config"
	"github.com/tomasweigenast/vps-manager/internal/db"
	"github.com/tomasweigenast/vps-manager/internal/docker"
	"github.com/tomasweigenast/vps-manager/internal/logbuffer"
	"github.com/tomasweigenast/vps-manager/internal/sse"
)

func main() {
	// Temporary default logger until config is loaded and logbuffer is wired.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "help", "--help", "-h":
			printUsage()
			return
		}
	}

	runServer()
}

func printUsage() {
	fmt.Println(`vps-manager — VPS management server

Usage:
  vps-manager              Start the HTTP server

Environment variables (see .env.example):
  COOKIE_SECRET, AUTH_MODE, LISTEN_ADDR, DATA_DIR,
  PROJECTS_DIR, FILES_ROOT, TLS_CERT, TLS_KEY`)
}

func runServer() {
	// Keep stdout logger active until config+DB are ready so startup errors are visible.
	logBuf := logbuffer.New(logbuffer.DefaultSize)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config error", "err", err)
		os.Exit(1)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		slog.Error("create data dir", "err", err)
		os.Exit(1)
	}

	database, err := db.Open(cfg.DataDir)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	// Re-wire slog with the configured sink now that the DB is available.
	var logLevel slog.Level
	if err := logLevel.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		logLevel = slog.LevelInfo
	}
	slog.SetDefault(slog.New(logbuffer.NewHandler(logBuf, database, logbuffer.Sink(cfg.LogSink), logLevel)))

	dockerClient, err := docker.NewClient()
	if err != nil {
		slog.Warn("docker unavailable — project management disabled", "err", err)
	}

	dockerManager := docker.NewManager(cfg.ProjectsDir, database, dockerClient)
	metricsHub := sse.NewHub()

	router := api.NewRouter(database, cfg, dockerManager, metricsHub, logBuf)

	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // SSE streams need no write timeout
		IdleTimeout:  120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("server starting", "addr", cfg.ListenAddr)
		var err error
		if cfg.TLSCert != "" && cfg.TLSKey != "" {
			err = srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down...")

	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("shutdown error", "err", err)
	}
}

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

	"golang.org/x/term"

	"github.com/tomasweigenast/vps-manager/internal/api"
	"github.com/tomasweigenast/vps-manager/internal/auth"
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
		case "adduser":
			runAddUser()
			return
		case "help", "--help", "-h":
			printUsage()
			return
		}
	}

	runServer()
}

func runAddUser() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: vps-manager adduser <username>")
		os.Exit(1)
	}
	username := os.Args[2]

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}
	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		fmt.Fprintf(os.Stderr, "create data dir: %v\n", err)
		os.Exit(1)
	}

	database, err := db.Open(cfg.DataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db: %v\n", err)
		os.Exit(1)
	}
	defer database.Close()

	fmt.Printf("Password for %s: ", username)
	passBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "read password: %v\n", err)
		os.Exit(1)
	}
	if len(passBytes) == 0 {
		fmt.Fprintln(os.Stderr, "password cannot be empty")
		os.Exit(1)
	}

	fmt.Printf("Confirm password: ")
	confirmBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	if err != nil {
		fmt.Fprintf(os.Stderr, "read password: %v\n", err)
		os.Exit(1)
	}

	if string(passBytes) != string(confirmBytes) {
		fmt.Fprintln(os.Stderr, "passwords do not match")
		os.Exit(1)
	}

	hash, err := auth.HashPassword(string(passBytes))
	if err != nil {
		fmt.Fprintf(os.Stderr, "hash password: %v\n", err)
		os.Exit(1)
	}

	user, err := db.CreateUser(database, username, db.AuthTypeLocal, &hash)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create user: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("User %q created (id=%d)\n", user.Username, user.ID)
}

func printUsage() {
	fmt.Println(`vps-manager — VPS management server

Usage:
  vps-manager              Start the HTTP server
  vps-manager adduser <username>
                           Create a local user (prompts for password)

Environment variables (see .env.example):
  COOKIE_SECRET, AUTH_MODE, LISTEN_ADDR, DATA_DIR,
  PROJECTS_DIR, FILES_ROOT, TLS_CERT, TLS_KEY`)
}

func runServer() {
	// Initialize the ring buffer immediately so every log line — including
	// config load, DB migration, and Docker init — is captured from the start.
	// We use memory sink until the DB is open, then swap to the configured sink.
	logBuf := logbuffer.New(logbuffer.DefaultSize)
	slog.SetDefault(slog.New(logbuffer.NewHandler(logBuf, nil, logbuffer.SinkMemory)))

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
	slog.SetDefault(slog.New(logbuffer.NewHandler(logBuf, database, logbuffer.Sink(cfg.LogSink))))

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

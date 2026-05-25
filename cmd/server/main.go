package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/tomasweigenast/vps-pilot/internal/api"
	"github.com/tomasweigenast/vps-pilot/internal/auth"
	"github.com/tomasweigenast/vps-pilot/internal/config"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/docker"
	"github.com/tomasweigenast/vps-pilot/internal/files"
	"github.com/tomasweigenast/vps-pilot/internal/logbuffer"
	"github.com/tomasweigenast/vps-pilot/internal/metrics"
	"golang.org/x/term"
)

// version is injected at build time via -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	// Temporary default logger until config is loaded and logbuffer is wired.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "help", "--help", "-h":
			printUsage()
			return
		case "version", "--version", "-v":
			fmt.Println("vps-pilot", version)
			return
		case "install":
			runInstall()
			return
		case "adduser":
			if len(os.Args) < 3 {
				fmt.Fprintln(os.Stderr, "usage: vps-pilot adduser <username>")
				os.Exit(1)
			}
			runAddUser(os.Args[2])
			return
		}
	}

	runServer()
}

// ensureConfigFile generates a default config file at cfgPath if it does not
// already exist. It is a no-op when cfgPath is empty or the file is present.
// In production, the config is created by "vps-pilot install". This fallback
// is useful for local dev runs without a pre-existing config.
func ensureConfigFile(cfgPath string) error {
	if cfgPath == "" {
		return nil
	}
	if _, err := os.Stat(cfgPath); err == nil {
		return nil // already exists
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	secret, err := config.GenerateCookieSecret()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	content := config.DefaultConfigContent(config.ConfigDefaults{CookieSecret: secret})
	if err := os.WriteFile(cfgPath, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write config file: %w", err)
	}

	slog.Info("generated default config file", "path", cfgPath,
		"note", "edit this file then restart the service")
	return nil
}

// loadSecretsKey resolves the AES-256 key used to encrypt secrets at rest.
//
// Priority:
//  1. $CREDENTIALS_DIRECTORY/vpm-secrets-key  — systemd-creds, TPM2-bound (most secure)
//  2. $DATA_DIR/secrets.key                   — persistent key file (mode 0400)
//  3. auto-generate and save to $DATA_DIR/secrets.key on first run
func loadSecretsKey(dataDir string) ([]byte, error) {
	// 1. systemd-creds credential (hardware-bound)
	if credDir := os.Getenv("CREDENTIALS_DIRECTORY"); credDir != "" {
		keyPath := filepath.Join(credDir, "vpm-secrets-key")
		if key, err := os.ReadFile(keyPath); err == nil && len(key) >= 32 {
			slog.Info("using systemd-creds secrets key")
			return key[:32], nil
		}
	}

	// 2. Persistent key file
	keyPath := filepath.Join(dataDir, "secrets.key")
	if key, err := os.ReadFile(keyPath); err == nil {
		if len(key) == 32 {
			return key, nil
		}
		slog.Warn("secrets.key has unexpected length, regenerating", "path", keyPath, "len", len(key))
	}

	// 3. First run: generate and persist
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate secrets key: %w", err)
	}
	if err := os.WriteFile(keyPath, key, 0o400); err != nil {
		return nil, fmt.Errorf("persist secrets key %s: %w", keyPath, err)
	}
	slog.Info("generated new secrets encryption key", "path", keyPath)
	return key, nil
}

func printUsage() {
	fmt.Printf(`vps-pilot %s - VPS management server

Usage:
  vps-pilot [--config FILE]   Start the HTTP server
  vps-pilot install           Interactive setup wizard (run as root)
  vps-pilot adduser NAME      Create a local auth user
  vps-pilot version           Print version and exit

Flags:
  --config FILE   Path to TOML config file
                  (default: /etc/vps-pilot/config.toml)

Config is read from the TOML file. Individual settings can be overridden
with environment variables: COOKIE_SECRET, AUTH_MODE, LISTEN_ADDR,
DATA_DIR, PROJECTS_DIR, FILES_ROOT, TLS_CERT, TLS_KEY, LOG_SINK, LOG_LEVEL.
`, version)
}

func runServer() {
	fs := flag.NewFlagSet("vps-pilot", flag.ExitOnError)
	cfgPath := fs.String("config", "/etc/vps-pilot/config.toml", "path to TOML config file")
	// Skip the subcommand tokens that main() already handled.
	args := os.Args[1:]
	if len(args) > 0 && (args[0] == "help" || args[0] == "version" || args[0] == "adduser" || args[0] == "install") {
		args = args[1:]
	}
	if err := fs.Parse(args); err != nil {
		os.Exit(1)
	}

	// Keep stdout logger active until config+DB are ready so startup errors are visible.
	logBuf := logbuffer.New(logbuffer.DefaultSize)

	// Auto-generate config file on first run (before dropping into the service user).
	if err := ensureConfigFile(*cfgPath); err != nil {
		slog.Error("failed to generate default config file", "path", *cfgPath, "err", err)
		os.Exit(1)
	}

	cfg, err := config.Load(*cfgPath)
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
	logLevelVar := new(slog.LevelVar)
	var parsedLevel slog.Level
	if err := parsedLevel.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
		parsedLevel = slog.LevelInfo
	}
	logLevelVar.Set(parsedLevel)
	logHandler := logbuffer.NewHandler(logBuf, database, logbuffer.Sink(cfg.LogSink), logLevelVar)
	slog.SetDefault(slog.New(logHandler))

	secretsKey, err := loadSecretsKey(cfg.DataDir)
	if err != nil {
		slog.Error("load secrets key", "err", err)
		os.Exit(1)
	}

	dockerClient, err := docker.NewClient()
	if err != nil {
		slog.Warn("docker unavailable — project management disabled", "err", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	api.AppVersion = version
	dockerManager := docker.NewManager(cfg.ProjectsDir, database, dockerClient, secretsKey)
	browser := files.NewBrowser(cfg.FilesRootDir)

	// Metrics recorder runs in its own cancellable context so it can be restarted on config change.
	metricsCtx, metricsCancel := context.WithCancel(ctx)
	metrics.StartMetricsRecorder(metricsCtx, database, cfg.MetricsInterval, cfg.MetricsRetention)

	reloader := &api.Reloader{
		LogHandler:       logHandler,
		LogBuf:           logBuf,
		LogDB:            database,
		DockerMgr:        dockerManager,
		FilesBrowser:     browser,
		MetricsCancel:    metricsCancel,
		MetricsParentCtx: ctx,
		MetricsDB:        database,
	}

	router := api.NewRouter(database, cfg, dockerManager, logBuf, secretsKey, dockerClient, browser, reloader)

	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // SSE streams need no write timeout
		IdleTimeout:  120 * time.Second,
	}

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

// runAddUser creates a local user interactively.
func runAddUser(username string) {
	// Load config to find data dir.
	cfgPath := "/etc/vps-pilot/config.toml"
	cfg, err := config.Load(cfgPath)
	if err != nil {
		// Try defaults.
		cfg = &config.Config{DataDir: "/var/lib/vps-pilot"}
	}

	database, err := db.Open(cfg.DataDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: open database:", err)
		os.Exit(1)
	}
	defer database.Close()

	// Prompt for password.
	var password string
	if term.IsTerminal(int(os.Stdin.Fd())) {
		fmt.Printf("Password for %s: ", username)
		pw, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil || len(pw) == 0 {
			fmt.Fprintln(os.Stderr, "error: password cannot be empty")
			os.Exit(1)
		}
		password = string(pw)
	} else {
		r := bufio.NewReader(os.Stdin)
		line, _ := r.ReadString('\n')
		password = strings.TrimSpace(line)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: hash password:", err)
		os.Exit(1)
	}

	if _, err := db.CreateUser(database, username, db.AuthTypeLocal, &hash); err != nil {
		fmt.Fprintln(os.Stderr, "error: create user:", err)
		os.Exit(1)
	}

	fmt.Printf("User %q created.\n", username)
}

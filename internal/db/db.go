package db

import (
	"database/sql"
	"embed"
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite3"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/mattn/go-sqlite3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func Open(dataDir string) (*sql.DB, error) {
	dsn := filepath.Join(dataDir, "vps-manager.db") +
		"?_journal_mode=WAL&_foreign_keys=ON&_busy_timeout=5000"

	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1) // SQLite WAL: single writer

	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, err
	}

	if err := ensureAdminAssigned(db); err != nil {
		slog.Warn("ensureAdminAssigned failed", "err", err)
	}

	slog.Debug("database opened", "path", dsn)
	return db, nil
}

func runMigrations(db *sql.DB) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("migrations source: %w", err)
	}

	driver, err := sqlite3.WithInstance(db, &sqlite3.Config{})
	if err != nil {
		return fmt.Errorf("migrations driver: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", src, "sqlite", driver)
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrate up: %w", err)
	}

	slog.Info("database migrations applied")
	return nil
}

// ensureAdminAssigned grants the admin role to all existing users if nobody has it yet.
// This repairs DBs that ran migration 006 before the auto-grant INSERT was added.
func ensureAdminAssigned(db *sql.DB) error {
	var adminCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`).Scan(&adminCount); err != nil {
		return err
	}
	if adminCount > 0 {
		return nil
	}
	var userCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&userCount); err != nil {
		return err
	}
	if userCount == 0 {
		return nil
	}
	_, err := db.Exec(`INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE r.name = 'admin'`)
	if err == nil {
		slog.Info("granted admin role to all existing users (one-time repair)")
	}
	return err
}

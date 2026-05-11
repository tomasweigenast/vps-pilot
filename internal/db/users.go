package db

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

type AuthType string

const (
	AuthTypePAM   AuthType = "pam"
	AuthTypeLocal AuthType = "local"
)

type User struct {
	ID           int64
	Username     string
	PasswordHash *string
	AuthType     AuthType
	CreatedAt    time.Time
	LastLogin    *time.Time
}

var ErrUserNotFound = errors.New("user not found")

func GetUserByUsername(db *sql.DB, username string) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, password_hash, auth_type, created_at, last_login FROM users WHERE username = ?`,
		username,
	)
	return scanUser(row)
}

func CreateUser(db *sql.DB, username string, authType AuthType, passwordHash *string) (*User, error) {
	res, err := db.Exec(
		`INSERT INTO users (username, auth_type, password_hash) VALUES (?, ?, ?)`,
		username, authType, passwordHash,
	)
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	id, _ := res.LastInsertId()
	slog.Debug("user created", "username", username, "auth_type", authType, "id", id)
	return GetUserByID(db, id)
}

func GetUserByID(db *sql.DB, id int64) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, password_hash, auth_type, created_at, last_login FROM users WHERE id = ?`,
		id,
	)
	return scanUser(row)
}

func UpdateLastLogin(db *sql.DB, userID int64) error {
	_, err := db.Exec(`UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`, userID)
	return err
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var lastLogin sql.NullString
	var createdAt string
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.AuthType, &createdAt, &lastLogin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	u.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	if lastLogin.Valid {
		t, _ := time.Parse(time.RFC3339, lastLogin.String)
		u.LastLogin = &t
	}
	return &u, nil
}

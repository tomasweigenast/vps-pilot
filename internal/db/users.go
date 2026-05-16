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
	Disabled     bool
	CreatedAt    time.Time
	LastLogin    *time.Time
}

var ErrUserNotFound = errors.New("user not found")

func GetUserByUsername(db *sql.DB, username string) (*User, error) {
	row := db.QueryRow(
		`SELECT id, username, password_hash, auth_type, disabled, created_at, last_login FROM users WHERE username = ?`,
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
		`SELECT id, username, password_hash, auth_type, disabled, created_at, last_login FROM users WHERE id = ?`,
		id,
	)
	return scanUser(row)
}

func ListUsers(database *sql.DB) ([]User, error) {
	rows, err := database.Query(
		`SELECT id, username, password_hash, auth_type, disabled, created_at, last_login FROM users ORDER BY username`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		var lastLogin sql.NullString
		var createdAt string
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.AuthType, &u.Disabled, &createdAt, &lastLogin); err != nil {
			return nil, err
		}
		u.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		if lastLogin.Valid {
			t, _ := time.Parse(time.RFC3339, lastLogin.String)
			u.LastLogin = &t
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func SetUserDisabled(database *sql.DB, id int64, disabled bool) error {
	_, err := database.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, disabled, id)
	return err
}

func DeleteUser(database *sql.DB, id int64) error {
	_, err := database.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// GetOrCreatePAMUser returns the DB record for a PAM user, creating one if it doesn't exist.
func GetOrCreatePAMUser(database *sql.DB, username string) (*User, error) {
	user, err := GetUserByUsername(database, username)
	if errors.Is(err, ErrUserNotFound) {
		return CreateUser(database, username, AuthTypePAM, nil)
	}
	return user, err
}

func CountUsers(database *sql.DB) (int, error) {
	var count int
	err := database.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func UpdateLastLogin(db *sql.DB, userID int64) error {
	_, err := db.Exec(`UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`, userID)
	return err
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	var lastLogin sql.NullString
	var createdAt string
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.AuthType, &u.Disabled, &createdAt, &lastLogin)
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

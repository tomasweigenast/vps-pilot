package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Secret is the DB model for a stored secret. Value is never populated on list
// responses — use GetSecretDecrypted for the raw bytes.
type Secret struct {
	ID          int64
	Name        string
	Description string
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ProjectSecret links a project to a secret, providing the env var name that
// receives the decrypted value at deploy time.
type ProjectSecret struct {
	SecretID   int64
	SecretName string
	EnvVarName string
}

var ErrSecretNotFound = errors.New("secret not found")

// CreateSecret stores a new secret. valueEncrypted must already be the
// AES-256-GCM blob (produced by secrets.Encrypt).
func CreateSecret(db *sql.DB, name, description, createdBy string, valueEncrypted []byte) (*Secret, error) {
	res, err := db.Exec(
		`INSERT INTO secrets (name, description, created_by, value_encrypted) VALUES (?, ?, ?, ?)`,
		name, description, createdBy, valueEncrypted,
	)
	if err != nil {
		return nil, fmt.Errorf("create secret: %w", err)
	}
	id, _ := res.LastInsertId()
	return GetSecret(db, id)
}

// GetSecret returns metadata for a secret (no encrypted value).
func GetSecret(db *sql.DB, id int64) (*Secret, error) {
	row := db.QueryRow(
		`SELECT id, name, description, created_by, created_at, updated_at FROM secrets WHERE id = ?`, id,
	)
	return scanSecret(row)
}

// GetSecretByName returns metadata for a secret by name.
func GetSecretByName(db *sql.DB, name string) (*Secret, error) {
	row := db.QueryRow(
		`SELECT id, name, description, created_by, created_at, updated_at FROM secrets WHERE name = ?`, name,
	)
	return scanSecret(row)
}

// GetSecretEncrypted returns the raw encrypted blob for a secret.
func GetSecretEncrypted(db *sql.DB, id int64) ([]byte, error) {
	var blob []byte
	err := db.QueryRow(`SELECT value_encrypted FROM secrets WHERE id = ?`, id).Scan(&blob)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSecretNotFound
	}
	return blob, err
}

// ListSecrets returns metadata for all secrets (no values).
func ListSecrets(db *sql.DB) ([]Secret, error) {
	rows, err := db.Query(
		`SELECT id, name, description, created_by, created_at, updated_at FROM secrets ORDER BY name`,
	)
	if err != nil {
		return nil, fmt.Errorf("list secrets: %w", err)
	}
	defer rows.Close()

	var out []Secret
	for rows.Next() {
		s, err := scanSecretRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// UpdateSecret updates the description and optionally the value of a secret.
// If valueEncrypted is nil the existing value is kept.
func UpdateSecret(db *sql.DB, id int64, description string, valueEncrypted []byte) error {
	var res sql.Result
	var err error
	if valueEncrypted != nil {
		res, err = db.Exec(
			`UPDATE secrets SET description = ?, value_encrypted = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
			description, valueEncrypted, id,
		)
	} else {
		res, err = db.Exec(
			`UPDATE secrets SET description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
			description, id,
		)
	}
	if err != nil {
		return fmt.Errorf("update secret: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrSecretNotFound
	}
	return nil
}

// DeleteSecret removes a secret and all project_secrets rows (via CASCADE).
func DeleteSecret(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM secrets WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete secret: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrSecretNotFound
	}
	return nil
}

// ListProjectSecrets returns all secrets (with env var names) attached to a project.
func ListProjectSecrets(db *sql.DB, projectName string) ([]ProjectSecret, error) {
	rows, err := db.Query(
		`SELECT ps.secret_id, s.name, ps.env_var_name
		 FROM project_secrets ps
		 JOIN secrets s ON s.id = ps.secret_id
		 WHERE ps.project_name = ?
		 ORDER BY s.name`,
		projectName,
	)
	if err != nil {
		return nil, fmt.Errorf("list project secrets: %w", err)
	}
	defer rows.Close()

	var out []ProjectSecret
	for rows.Next() {
		var ps ProjectSecret
		if err := rows.Scan(&ps.SecretID, &ps.SecretName, &ps.EnvVarName); err != nil {
			return nil, err
		}
		out = append(out, ps)
	}
	return out, rows.Err()
}

// SetProjectSecrets replaces all secrets for a project in a single transaction.
type ProjectSecretInput struct {
	SecretID   int64
	EnvVarName string
}

func SetProjectSecrets(db *sql.DB, projectName string, secrets []ProjectSecretInput) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM project_secrets WHERE project_name = ?`, projectName); err != nil {
		return fmt.Errorf("clear project secrets: %w", err)
	}
	for _, s := range secrets {
		if _, err := tx.Exec(
			`INSERT INTO project_secrets (project_name, secret_id, env_var_name) VALUES (?, ?, ?)`,
			projectName, s.SecretID, s.EnvVarName,
		); err != nil {
			return fmt.Errorf("insert project secret %d: %w", s.SecretID, err)
		}
	}
	return tx.Commit()
}

// ListProjectSecretsWithEncrypted returns all secret blobs for a project (used at deploy time).
type ProjectSecretBlob struct {
	EnvVarName     string
	ValueEncrypted []byte
}

func ListProjectSecretsWithEncrypted(db *sql.DB, projectName string) ([]ProjectSecretBlob, error) {
	rows, err := db.Query(
		`SELECT ps.env_var_name, s.value_encrypted
		 FROM project_secrets ps
		 JOIN secrets s ON s.id = ps.secret_id
		 WHERE ps.project_name = ?`,
		projectName,
	)
	if err != nil {
		return nil, fmt.Errorf("list project secret blobs: %w", err)
	}
	defer rows.Close()

	var out []ProjectSecretBlob
	for rows.Next() {
		var b ProjectSecretBlob
		if err := rows.Scan(&b.EnvVarName, &b.ValueEncrypted); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func scanSecret(row *sql.Row) (*Secret, error) {
	var s Secret
	var createdAt, updatedAt string
	err := row.Scan(&s.ID, &s.Name, &s.Description, &s.CreatedBy, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSecretNotFound
	}
	if err != nil {
		return nil, err
	}
	s.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	s.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return &s, nil
}

func scanSecretRow(rows *sql.Rows) (*Secret, error) {
	var s Secret
	var createdAt, updatedAt string
	if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.CreatedBy, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	s.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	s.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return &s, nil
}

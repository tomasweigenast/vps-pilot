package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Registry struct {
	ID        int64
	Name      string
	URL       string
	Username  string
	Secret    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrRegistryNotFound = errors.New("registry not found")

func CreateRegistry(db *sql.DB, name, url, username, secret string) (*Registry, error) {
	res, err := db.Exec(
		`INSERT INTO registries (name, url, username, secret) VALUES (?, ?, ?, ?)`,
		name, url, username, secret,
	)
	if err != nil {
		return nil, fmt.Errorf("create registry: %w", err)
	}
	id, _ := res.LastInsertId()
	return GetRegistry(db, id)
}

func GetRegistry(db *sql.DB, id int64) (*Registry, error) {
	row := db.QueryRow(
		`SELECT id, name, url, username, secret, created_at, updated_at FROM registries WHERE id = ?`, id,
	)
	return scanRegistry(row)
}

func ListRegistries(db *sql.DB) ([]Registry, error) {
	rows, err := db.Query(`SELECT id, name, url, username, secret, created_at, updated_at FROM registries ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list registries: %w", err)
	}
	defer rows.Close()

	var out []Registry
	for rows.Next() {
		var r Registry
		var createdAt, updatedAt string
		if err := rows.Scan(&r.ID, &r.Name, &r.URL, &r.Username, &r.Secret, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		r.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		r.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
		out = append(out, r)
	}
	return out, rows.Err()
}

func UpdateRegistry(db *sql.DB, id int64, name, url, username, secret string) error {
	res, err := db.Exec(
		`UPDATE registries SET name = ?, url = ?, username = ?, secret = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
		name, url, username, secret, id,
	)
	if err != nil {
		return fmt.Errorf("update registry: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrRegistryNotFound
	}
	return nil
}

func DeleteRegistry(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM registries WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete registry: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrRegistryNotFound
	}
	return nil
}

// FindRegistryForImage returns the registry whose URL is a prefix of the given image ref, or nil.
func FindRegistryForImage(registries []Registry, imageRef string) *Registry {
	for i := range registries {
		if len(imageRef) >= len(registries[i].URL) && imageRef[:len(registries[i].URL)] == registries[i].URL {
			return &registries[i]
		}
	}
	return nil
}

func scanRegistry(row *sql.Row) (*Registry, error) {
	var r Registry
	var createdAt, updatedAt string
	err := row.Scan(&r.ID, &r.Name, &r.URL, &r.Username, &r.Secret, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRegistryNotFound
	}
	if err != nil {
		return nil, err
	}
	r.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	r.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return &r, nil
}

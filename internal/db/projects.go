package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type ProjectRecord struct {
	ID        int64
	Name      string
	Compose   string
	EnvVars   map[string]string
	CreatedAt time.Time
	UpdatedAt time.Time
}

var ErrProjectNotFound = errors.New("project not found")

func CreateProject(db *sql.DB, name, compose string, envVars map[string]string) (*ProjectRecord, error) {
	env, err := marshalEnvVars(envVars)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(
		`INSERT INTO projects (name, compose, env_vars) VALUES (?, ?, ?)`,
		name, compose, env,
	)
	if err != nil {
		return nil, fmt.Errorf("create project: %w", err)
	}
	id, _ := res.LastInsertId()
	return GetProject(db, id)
}

func GetProjectByName(db *sql.DB, name string) (*ProjectRecord, error) {
	row := db.QueryRow(
		`SELECT id, name, compose, env_vars, created_at, updated_at FROM projects WHERE name = ?`,
		name,
	)
	return scanProject(row)
}

func GetProject(db *sql.DB, id int64) (*ProjectRecord, error) {
	row := db.QueryRow(
		`SELECT id, name, compose, env_vars, created_at, updated_at FROM projects WHERE id = ?`,
		id,
	)
	return scanProject(row)
}

func ListProjectRecords(db *sql.DB) ([]ProjectRecord, error) {
	rows, err := db.Query(
		`SELECT id, name, compose, env_vars, created_at, updated_at FROM projects ORDER BY name`,
	)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	var projects []ProjectRecord
	for rows.Next() {
		p, err := scanProjectRow(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, *p)
	}
	return projects, rows.Err()
}

func UpdateProject(db *sql.DB, name, compose string, envVars map[string]string) error {
	env, err := marshalEnvVars(envVars)
	if err != nil {
		return err
	}
	res, err := db.Exec(
		`UPDATE projects SET compose = ?, env_vars = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = ?`,
		compose, env, name,
	)
	if err != nil {
		return fmt.Errorf("update project: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrProjectNotFound
	}
	return nil
}

func DeleteProject(db *sql.DB, name string) error {
	res, err := db.Exec(`DELETE FROM projects WHERE name = ?`, name)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrProjectNotFound
	}
	return nil
}

func marshalEnvVars(env map[string]string) (string, error) {
	if env == nil {
		env = map[string]string{}
	}
	b, err := json.Marshal(env)
	if err != nil {
		return "", fmt.Errorf("marshal env vars: %w", err)
	}
	return string(b), nil
}

func scanProject(row *sql.Row) (*ProjectRecord, error) {
	var p ProjectRecord
	var envRaw, createdAt, updatedAt string
	err := row.Scan(&p.ID, &p.Name, &p.Compose, &envRaw, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrProjectNotFound
	}
	if err != nil {
		return nil, err
	}
	return finishScanProject(&p, envRaw, createdAt, updatedAt)
}

func scanProjectRow(rows *sql.Rows) (*ProjectRecord, error) {
	var p ProjectRecord
	var envRaw, createdAt, updatedAt string
	if err := rows.Scan(&p.ID, &p.Name, &p.Compose, &envRaw, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return finishScanProject(&p, envRaw, createdAt, updatedAt)
}

func finishScanProject(p *ProjectRecord, envRaw, createdAt, updatedAt string) (*ProjectRecord, error) {
	if err := json.Unmarshal([]byte(envRaw), &p.EnvVars); err != nil {
		p.EnvVars = map[string]string{}
	}
	p.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return p, nil
}

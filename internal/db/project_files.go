package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type ProjectFile struct {
	ID          int64
	ProjectName string
	Filename    string
	Content     string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

var ErrProjectFileNotFound = errors.New("project file not found")

func UpsertProjectFile(db *sql.DB, projectName, filename, content string) error {
	_, err := db.Exec(`
		INSERT INTO project_files (project_name, filename, content)
		VALUES (?, ?, ?)
		ON CONFLICT(project_name, filename) DO UPDATE SET
			content = excluded.content,
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
	`, projectName, filename, content)
	if err != nil {
		return fmt.Errorf("upsert project file: %w", err)
	}
	return nil
}

func ListProjectFiles(db *sql.DB, projectName string) ([]ProjectFile, error) {
	rows, err := db.Query(`
		SELECT id, project_name, filename, content, created_at, updated_at
		FROM project_files WHERE project_name = ? ORDER BY filename
	`, projectName)
	if err != nil {
		return nil, fmt.Errorf("list project files: %w", err)
	}
	defer rows.Close()

	var files []ProjectFile
	for rows.Next() {
		var f ProjectFile
		var createdAt, updatedAt string
		if err := rows.Scan(&f.ID, &f.ProjectName, &f.Filename, &f.Content, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		f.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		f.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
		files = append(files, f)
	}
	return files, rows.Err()
}

func DeleteProjectFile(db *sql.DB, projectName, filename string) error {
	res, err := db.Exec(
		`DELETE FROM project_files WHERE project_name = ? AND filename = ?`,
		projectName, filename,
	)
	if err != nil {
		return fmt.Errorf("delete project file: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrProjectFileNotFound
	}
	return nil
}

func DeleteAllProjectFiles(db *sql.DB, projectName string) error {
	_, err := db.Exec(`DELETE FROM project_files WHERE project_name = ?`, projectName)
	return err
}

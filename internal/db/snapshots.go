package db

import (
	"database/sql"
	"fmt"
	"time"
)

type ImageSnapshot struct {
	ID           int64
	ProjectName  string
	ServiceName  string
	ImageRef     string
	ImageID      string
	SnapshottedAt time.Time
}

func SaveSnapshots(db *sql.DB, projectName string, snaps []ImageSnapshot) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM project_image_snapshots WHERE project_name = ?`, projectName); err != nil {
		return fmt.Errorf("clear snapshots: %w", err)
	}
	for _, s := range snaps {
		if _, err := tx.Exec(
			`INSERT INTO project_image_snapshots (project_name, service_name, image_ref, image_id) VALUES (?, ?, ?, ?)`,
			projectName, s.ServiceName, s.ImageRef, s.ImageID,
		); err != nil {
			return fmt.Errorf("insert snapshot: %w", err)
		}
	}
	return tx.Commit()
}

func GetSnapshots(db *sql.DB, projectName string) ([]ImageSnapshot, error) {
	rows, err := db.Query(
		`SELECT id, project_name, service_name, image_ref, image_id, snapshotted_at FROM project_image_snapshots WHERE project_name = ? ORDER BY id`,
		projectName,
	)
	if err != nil {
		return nil, fmt.Errorf("get snapshots: %w", err)
	}
	defer rows.Close()

	var out []ImageSnapshot
	for rows.Next() {
		var s ImageSnapshot
		var snapAt string
		if err := rows.Scan(&s.ID, &s.ProjectName, &s.ServiceName, &s.ImageRef, &s.ImageID, &snapAt); err != nil {
			return nil, err
		}
		s.SnapshottedAt, _ = time.Parse(time.RFC3339Nano, snapAt)
		out = append(out, s)
	}
	return out, rows.Err()
}

func ClearSnapshots(db *sql.DB, projectName string) error {
	_, err := db.Exec(`DELETE FROM project_image_snapshots WHERE project_name = ?`, projectName)
	return err
}

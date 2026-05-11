package db

import (
	"database/sql"
	"fmt"
	"time"
)

type LogEntry struct {
	ID        int64
	CreatedAt time.Time
	Level     string
	Message   string
	Attrs     string // raw JSON
}

func InsertLog(db *sql.DB, level, message, attrs string) error {
	_, err := db.Exec(
		`INSERT INTO server_logs (level, message, attrs) VALUES (?, ?, ?)`,
		level, message, attrs,
	)
	return err
}

// QueryLogs returns up to limit entries, newest first, optionally filtered by search string.
func QueryLogs(db *sql.DB, limit int, search string) ([]LogEntry, error) {
	query := `SELECT id, created_at, level, message, attrs FROM server_logs`
	args := []any{}
	if search != "" {
		query += ` WHERE message LIKE ? OR attrs LIKE ?`
		like := "%" + search + "%"
		args = append(args, like, like)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query logs: %w", err)
	}
	defer rows.Close()

	var entries []LogEntry
	for rows.Next() {
		var e LogEntry
		var createdAt string
		var attrs sql.NullString
		if err := rows.Scan(&e.ID, &createdAt, &e.Level, &e.Message, &attrs); err != nil {
			return nil, err
		}
		e.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		if attrs.Valid {
			e.Attrs = attrs.String
		}
		entries = append(entries, e)
	}
	// Reverse to chronological order
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries, rows.Err()
}

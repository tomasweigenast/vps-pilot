package db

import (
	"database/sql"
	"time"
)

type AuditLog struct {
	ID        int64     `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	Username  string    `json:"username"`
	Action    string    `json:"action"`
	Resource  string    `json:"resource,omitempty"`
	Detail    string    `json:"detail,omitempty"`
	IP        string    `json:"ip,omitempty"`
}

func InsertAuditLog(db *sql.DB, entry AuditLog) error {
	_, err := db.Exec(
		`INSERT INTO audit_logs (username, action, resource, detail, ip) VALUES (?, ?, ?, ?, ?)`,
		entry.Username, entry.Action, entry.Resource, entry.Detail, entry.IP,
	)
	return err
}

func QueryAuditLogs(db *sql.DB, limit, offset int) ([]AuditLog, int, error) {
	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM audit_logs`).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := db.Query(
		`SELECT id, created_at, username, action, resource, detail, ip
		 FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []AuditLog
	for rows.Next() {
		var l AuditLog
		var createdAt string
		var resource, detail, ip sql.NullString
		if err := rows.Scan(&l.ID, &createdAt, &l.Username, &l.Action, &resource, &detail, &ip); err != nil {
			return nil, 0, err
		}
		l.CreatedAt, _ = time.Parse("2006-01-02T15:04:05.000Z", createdAt)
		l.Resource = resource.String
		l.Detail = detail.String
		l.IP = ip.String
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

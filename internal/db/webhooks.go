package db

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type Webhook struct {
	ID           int64      `json:"id"`
	Token        string     `json:"token"`
	ProjectName  string     `json:"projectName"`
	ServiceName  string     `json:"serviceName"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastCalledAt *time.Time `json:"lastCalledAt"`
	CallCount    int64      `json:"callCount"`
}

var ErrWebhookNotFound = errors.New("webhook not found")

func CreateWebhook(db *sql.DB, token, projectName, serviceName string) (*Webhook, error) {
	res, err := db.Exec(
		`INSERT INTO webhooks (token, project_name, service_name) VALUES (?, ?, NULLIF(?, ''))`,
		token, projectName, serviceName,
	)
	if err != nil {
		return nil, fmt.Errorf("create webhook: %w", err)
	}
	id, _ := res.LastInsertId()
	return GetWebhook(db, id)
}

func GetWebhook(db *sql.DB, id int64) (*Webhook, error) {
	row := db.QueryRow(
		`SELECT id, token, project_name, COALESCE(service_name,''), created_at, last_called_at, call_count FROM webhooks WHERE id = ?`, id,
	)
	return scanWebhook(row)
}

func GetWebhookByToken(db *sql.DB, token string) (*Webhook, error) {
	row := db.QueryRow(
		`SELECT id, token, project_name, COALESCE(service_name,''), created_at, last_called_at, call_count FROM webhooks WHERE token = ?`, token,
	)
	return scanWebhook(row)
}

func ListWebhooks(db *sql.DB, projectName string) ([]Webhook, error) {
	rows, err := db.Query(
		`SELECT id, token, project_name, COALESCE(service_name,''), created_at, last_called_at, call_count FROM webhooks WHERE project_name = ? ORDER BY created_at`,
		projectName,
	)
	if err != nil {
		return nil, fmt.Errorf("list webhooks: %w", err)
	}
	defer rows.Close()

	var out []Webhook
	for rows.Next() {
		w, err := scanWebhookRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func DeleteWebhook(db *sql.DB, id int64) error {
	res, err := db.Exec(`DELETE FROM webhooks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete webhook: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrWebhookNotFound
	}
	return nil
}

func RecordWebhookCall(db *sql.DB, id int64) error {
	_, err := db.Exec(
		`UPDATE webhooks SET last_called_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), call_count = call_count + 1 WHERE id = ?`,
		id,
	)
	return err
}

func scanWebhook(row *sql.Row) (*Webhook, error) {
	var w Webhook
	var createdAt string
	var lastCalledAt sql.NullString
	err := row.Scan(&w.ID, &w.Token, &w.ProjectName, &w.ServiceName, &createdAt, &lastCalledAt, &w.CallCount)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrWebhookNotFound
	}
	if err != nil {
		return nil, err
	}
	w.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	if lastCalledAt.Valid {
		t, _ := time.Parse(time.RFC3339Nano, lastCalledAt.String)
		w.LastCalledAt = &t
	}
	return &w, nil
}

func scanWebhookRow(rows *sql.Rows) (*Webhook, error) {
	var w Webhook
	var createdAt string
	var lastCalledAt sql.NullString
	if err := rows.Scan(&w.ID, &w.Token, &w.ProjectName, &w.ServiceName, &createdAt, &lastCalledAt, &w.CallCount); err != nil {
		return nil, err
	}
	w.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	if lastCalledAt.Valid {
		t, _ := time.Parse(time.RFC3339Nano, lastCalledAt.String)
		w.LastCalledAt = &t
	}
	return &w, nil
}

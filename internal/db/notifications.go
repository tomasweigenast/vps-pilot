package db

import (
	"database/sql"
	"errors"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

type NotificationChannel struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`   // "email"|"webhook"|"slack"|"discord"
	Config    string    `json:"config"` // raw JSON
	Enabled   bool      `json:"enabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type NotificationRule struct {
	ID            int64   `json:"id"`
	ChannelID     int64   `json:"channelId"`
	EventType     string  `json:"eventType"`
	ProjectFilter *string `json:"projectFilter"` // nil = all projects
	Enabled       bool    `json:"enabled"`
}

var ErrChannelNotFound = errors.New("notification channel not found")

// ─── Channels ─────────────────────────────────────────────────────────────────

func ListNotificationChannels(db *sql.DB) ([]NotificationChannel, error) {
	rows, err := db.Query(`
		SELECT id, name, type, config, enabled, created_at, updated_at
		FROM notification_channels ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []NotificationChannel
	for rows.Next() {
		var c NotificationChannel
		var enabledInt int
		var createdAt, updatedAt string
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Config, &enabledInt, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		c.Enabled = enabledInt == 1
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		c.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
		out = append(out, c)
	}
	return out, rows.Err()
}

func GetNotificationChannel(db *sql.DB, id int64) (*NotificationChannel, error) {
	var c NotificationChannel
	var enabledInt int
	var createdAt, updatedAt string
	err := db.QueryRow(`
		SELECT id, name, type, config, enabled, created_at, updated_at
		FROM notification_channels WHERE id = ?`, id).
		Scan(&c.ID, &c.Name, &c.Type, &c.Config, &enabledInt, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrChannelNotFound
	}
	if err != nil {
		return nil, err
	}
	c.Enabled = enabledInt == 1
	c.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	c.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updatedAt)
	return &c, nil
}

func CreateNotificationChannel(db *sql.DB, name, typ, config string, enabled bool) (*NotificationChannel, error) {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	res, err := db.Exec(`
		INSERT INTO notification_channels (name, type, config, enabled)
		VALUES (?, ?, ?, ?)`, name, typ, config, enabledInt)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return GetNotificationChannel(db, id)
}

func UpdateNotificationChannel(db *sql.DB, id int64, name, typ, config string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	_, err := db.Exec(`
		UPDATE notification_channels
		SET name=?, type=?, config=?, enabled=?,
		    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id=?`, name, typ, config, enabledInt, id)
	return err
}

func DeleteNotificationChannel(db *sql.DB, id int64) error {
	_, err := db.Exec(`DELETE FROM notification_channels WHERE id=?`, id)
	return err
}

// ─── Rules ────────────────────────────────────────────────────────────────────

func ListNotificationRules(db *sql.DB, channelID int64) ([]NotificationRule, error) {
	rows, err := db.Query(`
		SELECT id, channel_id, event_type, project_filter, enabled
		FROM notification_rules WHERE channel_id=? ORDER BY id`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []NotificationRule
	for rows.Next() {
		var r NotificationRule
		var enabledInt int
		if err := rows.Scan(&r.ID, &r.ChannelID, &r.EventType, &r.ProjectFilter, &enabledInt); err != nil {
			return nil, err
		}
		r.Enabled = enabledInt == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListAllNotificationRules(db *sql.DB) ([]NotificationRule, error) {
	rows, err := db.Query(`
		SELECT id, channel_id, event_type, project_filter, enabled
		FROM notification_rules ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []NotificationRule
	for rows.Next() {
		var r NotificationRule
		var enabledInt int
		if err := rows.Scan(&r.ID, &r.ChannelID, &r.EventType, &r.ProjectFilter, &enabledInt); err != nil {
			return nil, err
		}
		r.Enabled = enabledInt == 1
		out = append(out, r)
	}
	return out, rows.Err()
}

func CreateNotificationRule(db *sql.DB, channelID int64, eventType string, projectFilter *string, enabled bool) (*NotificationRule, error) {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	res, err := db.Exec(`
		INSERT INTO notification_rules (channel_id, event_type, project_filter, enabled)
		VALUES (?, ?, ?, ?)`, channelID, eventType, projectFilter, enabledInt)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	var r NotificationRule
	if err := db.QueryRow(`SELECT id, channel_id, event_type, project_filter, enabled FROM notification_rules WHERE id=?`, id).
		Scan(&r.ID, &r.ChannelID, &r.EventType, &r.ProjectFilter, &enabledInt); err != nil {
		return nil, err
	}
	r.Enabled = enabledInt == 1
	return &r, nil
}

func UpdateNotificationRule(db *sql.DB, id int64, eventType string, projectFilter *string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	_, err := db.Exec(`
		UPDATE notification_rules SET event_type=?, project_filter=?, enabled=? WHERE id=?`,
		eventType, projectFilter, enabledInt, id)
	return err
}

func DeleteNotificationRule(db *sql.DB, id int64) error {
	_, err := db.Exec(`DELETE FROM notification_rules WHERE id=?`, id)
	return err
}

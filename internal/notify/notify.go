// Package notify dispatches notifications to configured channels
// when Docker events match configured rules.
package notify

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"github.com/tomasweigenast/vps-pilot/internal/db"
)

// Event represents something that can trigger notifications.
type Event struct {
	// Type is the event type, e.g. "container.die", "deploy.success", "deploy.fail".
	Type string
	// Project is the affected project name.
	Project string
	// Detail is a human-readable description.
	Detail string
	// Time is when the event occurred.
	Time time.Time
}

// Dispatcher listens for Events and dispatches them to matching channels.
type Dispatcher struct {
	db *sql.DB
}

// NewDispatcher creates a new Dispatcher backed by the given database.
func NewDispatcher(database *sql.DB) *Dispatcher {
	return &Dispatcher{db: database}
}

// Dispatch sends the event to all enabled channels whose rules match.
func (d *Dispatcher) Dispatch(ctx context.Context, evt Event) {
	if evt.Time.IsZero() {
		evt.Time = time.Now()
	}

	rules, err := db.ListAllNotificationRules(d.db)
	if err != nil {
		slog.Warn("notify: failed to load rules", "err", err)
		return
	}

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if rule.EventType != evt.Type {
			continue
		}
		if rule.ProjectFilter != nil && *rule.ProjectFilter != "" {
			// Check comma-separated project names
			filters := strings.Split(*rule.ProjectFilter, ",")
			matched := false
			for _, f := range filters {
				if strings.TrimSpace(f) == evt.Project {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}

		ch, err := db.GetNotificationChannel(d.db, rule.ChannelID)
		if err != nil || !ch.Enabled {
			continue
		}

		go func(ch db.NotificationChannel, evt Event) {
			if err := send(ctx, ch, evt); err != nil {
				slog.Warn("notify: failed to send", "channel", ch.Name, "type", ch.Type, "err", err)
			}
		}(*ch, evt)
	}
}

// send dispatches a single event to a single channel.
func send(ctx context.Context, ch db.NotificationChannel, evt Event) error {
	switch ch.Type {
	case "webhook":
		return sendWebhook(ctx, ch.Config, evt)
	case "slack":
		return sendSlack(ctx, ch.Config, evt)
	case "discord":
		return sendDiscord(ctx, ch.Config, evt)
	case "email":
		return sendEmail(ch.Config, evt)
	default:
		return fmt.Errorf("unknown channel type: %s", ch.Type)
	}
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

type webhookConfig struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

func sendWebhook(ctx context.Context, cfgJSON string, evt Event) error {
	var cfg webhookConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.URL == "" {
		return fmt.Errorf("webhook: invalid config")
	}

	payload, _ := json.Marshal(map[string]any{
		"event":   evt.Type,
		"project": evt.Project,
		"detail":  evt.Detail,
		"time":    evt.Time.UTC().Format(time.RFC3339),
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range cfg.Headers {
		req.Header.Set(k, v)
	}

	c := &http.Client{Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook: response %d", resp.StatusCode)
	}
	return nil
}

// ─── Slack ────────────────────────────────────────────────────────────────────

type slackConfig struct {
	WebhookURL string `json:"webhookUrl"`
}

func sendSlack(ctx context.Context, cfgJSON string, evt Event) error {
	var cfg slackConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.WebhookURL == "" {
		return fmt.Errorf("slack: invalid config (need webhookUrl)")
	}

	text := fmt.Sprintf("*[%s]* %s — %s", evt.Type, evt.Project, evt.Detail)
	payload, _ := json.Marshal(map[string]string{"text": text})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	c := &http.Client{Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slack: response %d", resp.StatusCode)
	}
	return nil
}

// ─── Discord ──────────────────────────────────────────────────────────────────

type discordConfig struct {
	WebhookURL string `json:"webhookUrl"`
}

func sendDiscord(ctx context.Context, cfgJSON string, evt Event) error {
	var cfg discordConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.WebhookURL == "" {
		return fmt.Errorf("discord: invalid config (need webhookUrl)")
	}

	content := fmt.Sprintf("**[%s]** `%s` — %s", evt.Type, evt.Project, evt.Detail)
	payload, _ := json.Marshal(map[string]string{"content": content})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	c := &http.Client{Timeout: 10 * time.Second}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("discord: response %d", resp.StatusCode)
	}
	return nil
}

// ─── Email ────────────────────────────────────────────────────────────────────

type emailConfig struct {
	SMTPHost string `json:"smtpHost"`
	SMTPPort int    `json:"smtpPort"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
	To       string `json:"to"` // comma-separated
}

func sendEmail(cfgJSON string, evt Event) error {
	var cfg emailConfig
	if err := json.Unmarshal([]byte(cfgJSON), &cfg); err != nil || cfg.SMTPHost == "" || cfg.To == "" {
		return fmt.Errorf("email: invalid config (need smtpHost, to)")
	}
	if cfg.SMTPPort == 0 {
		cfg.SMTPPort = 587
	}
	if cfg.From == "" {
		cfg.From = "vps-manager@localhost"
	}

	to := strings.Split(cfg.To, ",")
	for i, t := range to {
		to[i] = strings.TrimSpace(t)
	}

	subject := fmt.Sprintf("[%s] %s — %s", evt.Type, evt.Project, evt.Detail)
	body := fmt.Sprintf("Event: %s\nProject: %s\nDetail: %s\nTime: %s\n",
		evt.Type, evt.Project, evt.Detail, evt.Time.UTC().Format(time.RFC3339))

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		cfg.From, strings.Join(to, ", "), subject, body)

	addr := fmt.Sprintf("%s:%d", cfg.SMTPHost, cfg.SMTPPort)

	var auth smtp.Auth
	if cfg.Username != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.SMTPHost)
	}

	return smtp.SendMail(addr, auth, cfg.From, to, []byte(msg))
}

// ─── Test helper ─────────────────────────────────────────────────────────────

// TestChannel attempts to send a test notification to a channel.
func TestChannel(ctx context.Context, ch db.NotificationChannel) error {
	return send(ctx, ch, Event{
		Type:    "test",
		Project: "test",
		Detail:  "This is a test notification from VPS Pilot",
		Time:    time.Now(),
	})
}

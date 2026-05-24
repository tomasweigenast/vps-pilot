package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/tomasweigenast/vps-pilot/internal/db"
	"github.com/tomasweigenast/vps-pilot/internal/notify"
)

type notificationsHandler struct {
	database *sql.DB
}

// ─── Channels ─────────────────────────────────────────────────────────────────

// GET /api/notifications/channels
func (h *notificationsHandler) listChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := db.ListNotificationChannels(h.database)
	if err != nil {
		serverErr(w, r, "list notification channels", err)
		return
	}
	if channels == nil {
		channels = []db.NotificationChannel{}
	}

	// Attach rules per channel
	type channelWithRules struct {
		db.NotificationChannel
		Rules []db.NotificationRule `json:"rules"`
	}
	out := make([]channelWithRules, len(channels))
	for i, ch := range channels {
		rules, _ := db.ListNotificationRules(h.database, ch.ID)
		if rules == nil {
			rules = []db.NotificationRule{}
		}
		out[i] = channelWithRules{ch, rules}
	}
	jsonOK(w, out)
}

// POST /api/notifications/channels
func (h *notificationsHandler) createChannel(w http.ResponseWriter, r *http.Request) {
	var inp struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Config  string `json:"config"`
		Enabled *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Name == "" || inp.Type == "" {
		jsonErr(w, http.StatusBadRequest, "name and type are required")
		return
	}
	if inp.Config == "" {
		inp.Config = "{}"
	}
	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}
	ch, err := db.CreateNotificationChannel(h.database, inp.Name, inp.Type, inp.Config, enabled)
	if err != nil {
		serverErr(w, r, "create notification channel", err)
		return
	}
	jsonOK(w, ch)
}

// PUT /api/notifications/channels/{id}
func (h *notificationsHandler) updateChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var inp struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Config  string `json:"config"`
		Enabled *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Config == "" {
		inp.Config = "{}"
	}
	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}
	if err := db.UpdateNotificationChannel(h.database, id, inp.Name, inp.Type, inp.Config, enabled); err != nil {
		serverErr(w, r, "update notification channel", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/notifications/channels/{id}
func (h *notificationsHandler) deleteChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := db.DeleteNotificationChannel(h.database, id); err != nil {
		serverErr(w, r, "delete notification channel", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/notifications/channels/{id}/test
func (h *notificationsHandler) testChannel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	ch, err := db.GetNotificationChannel(h.database, id)
	if err != nil {
		jsonErr(w, http.StatusNotFound, "channel not found")
		return
	}
	if err := notify.TestChannel(r.Context(), *ch); err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOK(w, map[string]bool{"ok": true})
}

// ─── Rules ────────────────────────────────────────────────────────────────────

// POST /api/notifications/channels/{id}/rules
func (h *notificationsHandler) createRule(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid channel id")
		return
	}
	var inp struct {
		EventType     string  `json:"eventType"`
		ProjectFilter *string `json:"projectFilter"`
		Enabled       *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.EventType == "" {
		jsonErr(w, http.StatusBadRequest, "eventType is required")
		return
	}
	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}
	rule, err := db.CreateNotificationRule(h.database, channelID, inp.EventType, inp.ProjectFilter, enabled)
	if err != nil {
		serverErr(w, r, "create notification rule", err)
		return
	}
	jsonOK(w, rule)
}

// PUT /api/notifications/rules/{id}
func (h *notificationsHandler) updateRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var inp struct {
		EventType     string  `json:"eventType"`
		ProjectFilter *string `json:"projectFilter"`
		Enabled       *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	enabled := true
	if inp.Enabled != nil {
		enabled = *inp.Enabled
	}
	if err := db.UpdateNotificationRule(h.database, id, inp.EventType, inp.ProjectFilter, enabled); err != nil {
		serverErr(w, r, "update notification rule", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/notifications/rules/{id}
func (h *notificationsHandler) deleteRule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := db.DeleteNotificationRule(h.database, id); err != nil {
		serverErr(w, r, "delete notification rule", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	cronpkg "github.com/tomasweigenast/vps-pilot/internal/cron"
)

type cronHandler struct{}

// listUsers returns system users that could have crontabs.
func (h *cronHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	users := cronpkg.ListCronUsers()
	if users == nil {
		users = []string{}
	}
	jsonOK(w, users)
}

// getCrontab returns the raw crontab text and parsed entries for a user.
func (h *cronHandler) getCrontab(w http.ResponseWriter, r *http.Request) {
	user := chi.URLParam(r, "user")
	if !validUsername(user) {
		jsonErr(w, http.StatusBadRequest, "invalid username")
		return
	}
	raw, err := cronpkg.ReadCrontab(user)
	if err != nil {
		serverErr(w, r, "read crontab", err)
		return
	}
	entries := cronpkg.ParseCrontab(raw)
	jsonOK(w, map[string]any{
		"raw":     raw,
		"entries": entries,
	})
}

// saveRaw replaces the crontab for a user with raw text.
func (h *cronHandler) saveRaw(w http.ResponseWriter, r *http.Request) {
	user := chi.URLParam(r, "user")
	if !validUsername(user) {
		jsonErr(w, http.StatusBadRequest, "invalid username")
		return
	}
	var inp struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if err := cronpkg.WriteCrontab(user, inp.Content); err != nil {
		serverErr(w, r, "write crontab", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// saveEntries saves cron entries (from visual editor) as a crontab.
func (h *cronHandler) saveEntries(w http.ResponseWriter, r *http.Request) {
	user := chi.URLParam(r, "user")
	if !validUsername(user) {
		jsonErr(w, http.StatusBadRequest, "invalid username")
		return
	}
	var entries []cronpkg.CronEntry
	if err := json.NewDecoder(r.Body).Decode(&entries); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	content := cronpkg.SerializeCrontab(entries)
	if err := cronpkg.WriteCrontab(user, content); err != nil {
		serverErr(w, r, "write crontab", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// validate checks a cron expression and returns the next N run times.
func (h *cronHandler) validate(w http.ResponseWriter, r *http.Request) {
	var inp struct {
		Expression string `json:"expression"`
		Count      int    `json:"count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&inp); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if inp.Expression == "" {
		jsonErr(w, http.StatusBadRequest, "expression is required")
		return
	}
	if inp.Count <= 0 || inp.Count > 20 {
		inp.Count = 5
	}
	nexts, err := cronpkg.ValidateExpression(inp.Expression, inp.Count)
	if err != nil {
		jsonErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	jsonOK(w, map[string]any{"nextRuns": nexts})
}

// validUsername checks that a username contains only safe characters.
func validUsername(u string) bool {
	if u == "" || len(u) > 64 {
		return false
	}
	for _, ch := range u {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '_' || ch == '-' || ch == '.') {
			return false
		}
	}
	return !strings.Contains(u, "..")
}

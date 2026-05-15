package api

import (
	"database/sql"
	"log/slog"
	"net"
	"net/http"
	"strconv"

	"github.com/tomasweigenast/vps-manager/internal/db"
)

type auditHandler struct {
	database *sql.DB
}

func (h *auditHandler) list(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	logs, total, err := db.QueryAuditLogs(h.database, limit, offset)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if logs == nil {
		logs = []db.AuditLog{}
	}
	jsonOK(w, map[string]any{
		"logs":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// logAudit records a user action. Non-blocking — errors are only logged.
func logAudit(r *http.Request, database *sql.DB, action, resource, detail string) {
	session := sessionFromCtx(r.Context())
	username := "anonymous"
	if session != nil {
		username = session.Username
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = fwd
	}
	if err := db.InsertAuditLog(database, db.AuditLog{
		Username: username,
		Action:   action,
		Resource: resource,
		Detail:   detail,
		IP:       ip,
	}); err != nil {
		slog.Warn("audit log insert failed", "err", err)
	}
}

package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func jsonOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonErr(w http.ResponseWriter, status int, msg string) {
	// Automatically log all 5xx errors so they're never silent — the dev
	// shouldn't have to check the frontend toast to discover server bugs.
	if status >= 500 {
		slog.Error("server error", "status", status, "message", msg)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// serverErr logs the error server-side with structured context and returns 500.
// Prefer over bare jsonErr(w, 500, ...) when you have a structured error value.
func serverErr(w http.ResponseWriter, r *http.Request, op string, err error) {
	slog.Error(op, "err", err, "method", r.Method, "path", r.URL.Path)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"
)

type reqIDKey struct{}

func requestID(ctx context.Context) string {
	id, _ := ctx.Value(reqIDKey{}).(string)
	return id
}

// statusRecorder wraps ResponseWriter to capture the written status code.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 8)
		rand.Read(b) //nolint:errcheck // crypto/rand never errors on reasonable systems
		id := hex.EncodeToString(b)

		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), reqIDKey{}, id)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()

		next.ServeHTTP(rec, r.WithContext(ctx))

		slog.Info("request",
			"id", id,
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"ms", time.Since(start).Milliseconds(),
			"ip", r.RemoteAddr,
		)
	})
}

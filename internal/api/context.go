package api

import (
	"context"

	"github.com/tomasweigenast/vps-manager/internal/auth"
)

type contextKey string

const sessionKey contextKey = "session"

func withSession(ctx context.Context, s *auth.SessionData) context.Context {
	return context.WithValue(ctx, sessionKey, s)
}

func sessionFromCtx(ctx context.Context) *auth.SessionData {
	s, _ := ctx.Value(sessionKey).(*auth.SessionData)
	return s
}

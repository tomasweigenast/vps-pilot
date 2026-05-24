//go:build !linux

package auth

import (
	"context"
	"database/sql"
	"errors"

	"github.com/tomasweigenast/vps-pilot/internal/db"
)

func AuthenticatePAM(_ context.Context, _ *sql.DB, _, _ string) (*db.User, error) {
	return nil, errors.New("PAM authentication not supported on this platform")
}

//go:build linux

package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"

	"github.com/msteinert/pam/v2"
	"github.com/tomasweigenast/vps-manager/internal/db"
)

func AuthenticatePAM(ctx context.Context, database *sql.DB, username, password string) (*db.User, error) {
	slog.Debug("PAM auth attempt", "username", username)

	type result struct {
		err error
	}
	ch := make(chan result, 1)

	go func() {
		t, err := pam.StartFunc("login", username, func(s pam.Style, msg string) (string, error) {
			switch s {
			case pam.PromptEchoOff:
				return password, nil
			case pam.PromptEchoOn:
				return username, nil
			default:
				return "", nil
			}
		})
		if err != nil {
			ch <- result{fmt.Errorf("pam start: %w", err)}
			return
		}
		if err := t.Authenticate(0); err != nil {
			ch <- result{ErrInvalidCredentials}
			return
		}
		ch <- result{nil}
	}()

	select {
	case <-ctx.Done():
		slog.Warn("PAM auth timeout", "username", username)
		return nil, errors.New("pam auth timeout")
	case r := <-ch:
		if r.err != nil {
			if !errors.Is(r.err, ErrInvalidCredentials) {
				slog.Warn("PAM system error", "username", username, "err", r.err)
			}
			return nil, r.err
		}
	}

	slog.Info("PAM auth success", "username", username)

	user, err := db.GetUserByUsername(database, username)
	if errors.Is(err, db.ErrUserNotFound) {
		user, err = db.CreateUser(database, username, db.AuthTypePAM, nil)
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if err := db.UpdateLastLogin(database, user.ID); err != nil {
		slog.Debug("update last_login failed", "username", username, "err", err)
	}
	return user, nil
}

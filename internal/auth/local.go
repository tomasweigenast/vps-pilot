package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/tomasweigenast/vps-pilot/internal/db"
	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 2
	argonMemory  = 64 * 1024
	argonThreads = 2
	argonKeyLen  = 32
	saltLen      = 16
)

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrUserDisabled = errors.New("account disabled")

func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	encoded := fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}

	var m, t uint32
	var p uint8
	if n, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); n != 3 || err != nil {
		slog.Warn("invalid argon2 hash params", "parts", parts[3])
		return false, errors.New("invalid hash params")
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	storedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}

	candidate := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(storedHash)))
	return subtle.ConstantTimeCompare(candidate, storedHash) == 1, nil
}

func AuthenticateLocal(database *sql.DB, username, password string) (*db.User, error) {
	slog.Debug("local auth attempt", "username", username)

	user, err := db.GetUserByUsername(database, username)
	if errors.Is(err, db.ErrUserNotFound) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if user.AuthType != db.AuthTypeLocal || user.PasswordHash == nil {
		return nil, ErrInvalidCredentials
	}

	ok, err := VerifyPassword(password, *user.PasswordHash)
	if err != nil || !ok {
		return nil, ErrInvalidCredentials
	}

	if user.Disabled {
		return nil, ErrUserDisabled
	}

	if err := db.UpdateLastLogin(database, user.ID); err != nil {
		slog.Debug("update last_login failed", "username", username, "err", err)
	}
	return user, nil
}

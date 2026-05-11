package db

import (
	"database/sql"
	"testing"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestOpen_CreatesSchema(t *testing.T) {
	database := openTestDB(t)
	// users table should exist
	row := database.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'`)
	var count int
	if err := row.Scan(&count); err != nil {
		t.Fatalf("query schema: %v", err)
	}
	if count != 1 {
		t.Error("users table not created by migration")
	}
}

func TestCreateUser_Roundtrip(t *testing.T) {
	database := openTestDB(t)
	hash := "somehash"
	user, err := CreateUser(database, "alice", AuthTypeLocal, &hash)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if user.Username != "alice" {
		t.Errorf("username: got %q, want %q", user.Username, "alice")
	}
	if user.AuthType != AuthTypeLocal {
		t.Errorf("auth_type: got %q, want %q", user.AuthType, AuthTypeLocal)
	}
	if user.PasswordHash == nil || *user.PasswordHash != hash {
		t.Error("password hash mismatch")
	}

	// Get by username
	got, err := GetUserByUsername(database, "alice")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if got.ID != user.ID {
		t.Errorf("id mismatch: got %d, want %d", got.ID, user.ID)
	}
}

func TestCreateUser_DuplicateUsername(t *testing.T) {
	database := openTestDB(t)
	CreateUser(database, "bob", AuthTypeLocal, nil)
	_, err := CreateUser(database, "bob", AuthTypePAM, nil)
	if err == nil {
		t.Error("expected error for duplicate username")
	}
}

func TestGetUserByUsername_NotFound(t *testing.T) {
	database := openTestDB(t)
	_, err := GetUserByUsername(database, "nobody")
	if err != ErrUserNotFound {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
}

func TestUpdateLastLogin(t *testing.T) {
	database := openTestDB(t)
	user, _ := CreateUser(database, "carol", AuthTypeLocal, nil)

	if user.LastLogin != nil {
		t.Error("last_login should be nil before update")
	}

	if err := UpdateLastLogin(database, user.ID); err != nil {
		t.Fatalf("UpdateLastLogin: %v", err)
	}

	updated, _ := GetUserByID(database, user.ID)
	if updated.LastLogin == nil {
		t.Error("last_login should be set after update")
	}
}

package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var ErrSystemRole = errors.New("cannot modify system role")
var ErrRoleNotFound = errors.New("role not found")

type Permission struct {
	ID          int64    `json:"id"`
	RoleID      int64    `json:"roleId"`
	ProjectName string   `json:"projectName"`
	Actions     []string `json:"actions"`
}

type Role struct {
	ID          int64        `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	IsSystem    bool         `json:"isSystem"`
	CreatedAt   time.Time    `json:"createdAt"`
	Permissions []Permission `json:"permissions"`
}

func ListRoles(database *sql.DB) ([]Role, error) {
	rows, err := database.Query(
		`SELECT id, name, description, is_system, created_at FROM roles ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var roles []Role
	for rows.Next() {
		var ro Role
		var createdAt string
		if err := rows.Scan(&ro.ID, &ro.Name, &ro.Description, &ro.IsSystem, &createdAt); err != nil {
			return nil, err
		}
		ro.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		roles = append(roles, ro)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range roles {
		perms, err := listRolePermissions(database, roles[i].ID)
		if err != nil {
			return nil, err
		}
		roles[i].Permissions = perms
	}
	return roles, nil
}

func GetRole(database *sql.DB, id int64) (*Role, error) {
	var ro Role
	var createdAt string
	err := database.QueryRow(
		`SELECT id, name, description, is_system, created_at FROM roles WHERE id = ?`, id,
	).Scan(&ro.ID, &ro.Name, &ro.Description, &ro.IsSystem, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrRoleNotFound
	}
	if err != nil {
		return nil, err
	}
	ro.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
	perms, err := listRolePermissions(database, ro.ID)
	if err != nil {
		return nil, err
	}
	ro.Permissions = perms
	return &ro, nil
}

func listRolePermissions(database *sql.DB, roleID int64) ([]Permission, error) {
	rows, err := database.Query(
		`SELECT id, role_id, project_name, actions FROM role_permissions WHERE role_id = ?`, roleID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	perms := []Permission{}
	for rows.Next() {
		var p Permission
		var actionsJSON string
		if err := rows.Scan(&p.ID, &p.RoleID, &p.ProjectName, &actionsJSON); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(actionsJSON), &p.Actions); err != nil {
			return nil, fmt.Errorf("parse actions: %w", err)
		}
		perms = append(perms, p)
	}
	return perms, rows.Err()
}

func CreateRole(database *sql.DB, name, description string, perms []Permission) (*Role, error) {
	tx, err := database.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(
		`INSERT INTO roles (name, description) VALUES (?, ?)`, name, description,
	)
	if err != nil {
		return nil, fmt.Errorf("create role: %w", err)
	}
	roleID, _ := res.LastInsertId()

	if err := insertPermissions(tx, roleID, perms); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetRole(database, roleID)
}

func UpdateRole(database *sql.DB, id int64, name, description string, perms []Permission) error {
	ro, err := GetRole(database, id)
	if err != nil {
		return err
	}
	if ro.IsSystem {
		return ErrSystemRole
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE roles SET name = ?, description = ? WHERE id = ?`, name, description, id,
	); err != nil {
		return fmt.Errorf("update role: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM role_permissions WHERE role_id = ?`, id); err != nil {
		return err
	}
	if err := insertPermissions(tx, id, perms); err != nil {
		return err
	}

	return tx.Commit()
}

func DeleteRole(database *sql.DB, id int64) error {
	ro, err := GetRole(database, id)
	if err != nil {
		return err
	}
	if ro.IsSystem {
		return ErrSystemRole
	}
	_, err = database.Exec(`DELETE FROM roles WHERE id = ?`, id)
	return err
}

func insertPermissions(tx *sql.Tx, roleID int64, perms []Permission) error {
	for _, p := range perms {
		actionsJSON, err := json.Marshal(p.Actions)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO role_permissions (role_id, project_name, actions) VALUES (?, ?, ?)`,
			roleID, p.ProjectName, string(actionsJSON),
		); err != nil {
			return fmt.Errorf("insert permission: %w", err)
		}
	}
	return nil
}

func AssignRolesToUser(database *sql.DB, userID int64, roleIDs []int64) error {
	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM user_roles WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, rid := range roleIDs {
		if _, err := tx.Exec(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`, userID, rid); err != nil {
			return fmt.Errorf("assign role %d: %w", rid, err)
		}
	}
	return tx.Commit()
}

func GetUserRoles(database *sql.DB, userID int64) ([]Role, error) {
	rows, err := database.Query(
		`SELECT r.id, r.name, r.description, r.is_system, r.created_at
		 FROM roles r JOIN user_roles ur ON ur.role_id = r.id
		 WHERE ur.user_id = ? ORDER BY r.name`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var roles []Role
	for rows.Next() {
		var ro Role
		var createdAt string
		if err := rows.Scan(&ro.ID, &ro.Name, &ro.Description, &ro.IsSystem, &createdAt); err != nil {
			return nil, err
		}
		ro.CreatedAt, _ = time.Parse(time.RFC3339Nano, createdAt)
		roles = append(roles, ro)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range roles {
		perms, err := listRolePermissions(database, roles[i].ID)
		if err != nil {
			return nil, err
		}
		roles[i].Permissions = perms
	}
	return roles, nil
}

// IsUserAdmin returns true if the user has the system admin role.
func IsUserAdmin(database *sql.DB, userID int64) (bool, error) {
	var count int
	err := database.QueryRow(
		`SELECT COUNT(*) FROM user_roles ur
		 JOIN roles r ON r.id = ur.role_id
		 WHERE ur.user_id = ? AND r.is_system = TRUE AND r.name = 'admin'`, userID,
	).Scan(&count)
	return count > 0, err
}

// GlobalActions is the list of all known global (non-project) permission actions.
var GlobalActions = []string{
	"view_dashboard",
	"view_system",
	"view_logs",
	"view_files",
	"edit_files",
	"view_audit",
}

// GetUserGlobalPermissions returns the global actions (project_name='*') granted to the user.
// Admins receive all global actions.
func GetUserGlobalPermissions(database *sql.DB, userID int64) ([]string, error) {
	isAdmin, err := IsUserAdmin(database, userID)
	if err != nil {
		return nil, err
	}
	if isAdmin {
		return GlobalActions, nil
	}

	rows, err := database.Query(`
		SELECT DISTINCT je.value
		FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN json_each(rp.actions) je
		WHERE ur.user_id = ? AND rp.project_name = '*'
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var actions []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return nil, err
		}
		actions = append(actions, a)
	}
	return actions, rows.Err()
}

// UserHasPermission checks if the user has the given action on the given project.
// Admin users always return true (call IsUserAdmin first or inline the check).
func UserHasPermission(database *sql.DB, userID int64, projectName, action string) (bool, error) {
	// Check admin shortcut
	isAdmin, err := IsUserAdmin(database, userID)
	if err != nil {
		return false, err
	}
	if isAdmin {
		return true, nil
	}

	var count int
	err = database.QueryRow(`
		SELECT COUNT(*) FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN json_each(rp.actions) je ON je.value = ? OR je.value = 'admin'
		WHERE ur.user_id = ?
		  AND (rp.project_name = '*' OR rp.project_name = ?)
	`, action, userID, projectName).Scan(&count)
	return count > 0, err
}

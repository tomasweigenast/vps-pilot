-- Grant all project and global actions to the admin role
INSERT INTO role_permissions (role_id, project_name, actions)
SELECT id, '*', '["view","start","stop","restart","deploy","logs","files","manage","view_dashboard","view_system","view_logs","view_files","edit_files","view_audit"]'
FROM roles WHERE name = 'admin';

-- Create the viewer system role
INSERT INTO roles (name, description, is_system) VALUES ('viewer', 'Read-only access to all sections', TRUE);

INSERT INTO role_permissions (role_id, project_name, actions)
SELECT id, '*', '["view","view_dashboard","view_system","view_logs","view_files","view_audit"]'
FROM roles WHERE name = 'viewer';

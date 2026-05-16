DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = 'admin');
DELETE FROM roles WHERE name = 'viewer';

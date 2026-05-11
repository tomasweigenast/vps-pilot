CREATE TABLE project_files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
    filename     TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(project_name, filename)
);

CREATE TABLE server_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    level      TEXT NOT NULL,
    message    TEXT NOT NULL,
    attrs      TEXT
);

CREATE INDEX idx_server_logs_created_at ON server_logs (created_at DESC);

CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  service_name TEXT,
  created_at DATETIME DEFAULT (datetime('now')),
  last_called_at DATETIME,
  call_count INTEGER DEFAULT 0
);
CREATE INDEX idx_webhooks_token ON webhooks(token);
CREATE INDEX idx_webhooks_project ON webhooks(project_name);

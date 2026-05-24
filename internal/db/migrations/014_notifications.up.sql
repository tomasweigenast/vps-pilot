CREATE TABLE IF NOT EXISTS notification_channels (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  type    TEXT NOT NULL,   -- 'email'|'webhook'|'slack'|'discord'
  config  TEXT NOT NULL DEFAULT '{}',  -- JSON payload
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id     INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,  -- 'container.die'|'container.health_status'|'deploy.success'|'deploy.fail'
  project_filter TEXT,           -- NULL = all projects; comma-separated project names
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

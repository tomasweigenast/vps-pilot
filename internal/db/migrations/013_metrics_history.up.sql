CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  cpu_percent    REAL,
  mem_used       INTEGER,
  mem_total      INTEGER,
  disk_used      INTEGER,
  disk_total     INTEGER,
  net_bytes_sent INTEGER,
  net_bytes_recv INTEGER
);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_recorded_at ON metrics_snapshots(recorded_at);

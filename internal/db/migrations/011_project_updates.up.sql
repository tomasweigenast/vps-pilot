ALTER TABLE projects ADD COLUMN remove_stale_images BOOLEAN DEFAULT FALSE;

CREATE TABLE project_image_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  image_id TEXT NOT NULL,
  snapshotted_at DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_project ON project_image_snapshots(project_name);

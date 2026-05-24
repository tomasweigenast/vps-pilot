CREATE TABLE secrets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL UNIQUE,
  description      TEXT    NOT NULL DEFAULT '',
  value_encrypted  BLOB    NOT NULL,
  created_by       TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE project_secrets (
  project_name TEXT    NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  secret_id    INTEGER NOT NULL REFERENCES secrets(id)   ON DELETE CASCADE,
  env_var_name TEXT    NOT NULL,
  PRIMARY KEY (project_name, secret_id)
);

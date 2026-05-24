# vps-pilot

A Go HTTP server for managing a VPS focused on Docker Compose deployments. Ships as a single self-contained binary (~17MB) with an embedded web UI.

**Features:** 
- System metrics (CPU/mem/disk/net), 
- Docker Compose project management (list/start/stop/logs/build)
- Container management & resource monitoring
- Read-only file browser + container file browser
- Dual authentication (Linux PAM + local users)
- RBAC roles 
- Secrets management (AES-256-GCM)
- Backup & Restore
- Cron job management
- Notifications
- Webhooks

---

## Prerequisites

| Tool | Purpose |
|---|---|
| Go 1.25+ | Build |
| [Bun](https://bun.sh) | Build the React frontend (`make build` / `make web`) |
| Docker + Docker CLI | Docker Compose project management at runtime |
| PAM dev headers *(optional)* | PAM auth on Linux (`libpam0g-dev` on Debian/Ubuntu) |

---

## Quick Start

```bash
# 1. Build
make build

# 2. Generate a cookie secret
export COOKIE_SECRET=$(openssl rand -hex 32)

# 3. Create a local user
./vps-pilot adduser admin

# 4. Start the server
./vps-pilot
# → http://localhost:8080
```

> **Tip:** For production, use the interactive install wizard instead — see [Install Wizard](#install-wizard) below.

---

## Configuration

Configuration is read from a TOML file (default: `/etc/vps-pilot/config.toml`) with environment variable overrides. The `vps-pilot install` wizard generates this file automatically.

| Variable / TOML key | Default | Description |
|---|---|---|
| `COOKIE_SECRET` / `cookie_secret` | **required** | 32 random bytes as hex (`openssl rand -hex 32`) |
| `AUTH_MODE` / `auth_mode` | `both` | `pam` · `local` · `both` |
| `LISTEN_ADDR` / `listen_addr` | `0.0.0.0:8080` | HTTP listen address |
| `DATA_DIR` / `data_dir` | `/var/lib/vps-pilot` | SQLite database directory |
| `PROJECTS_DIR` / `projects_dir` | `/opt/projects` | Docker Compose project root |
| `FILES_ROOT` / `files_root` | `/` | File browser root (users cannot browse above this) |
| `TLS_CERT` / `tls_cert` | *(empty)* | Path to TLS certificate (optional) |
| `TLS_KEY` / `tls_key` | *(empty)* | Path to TLS private key (optional) |
| `LOG_SINK` / `log_sink` | `both` | Where to write logs: `stdout` · `db` · `both` |
| `LOG_LEVEL` / `log_level` | `info` | Minimum log level: `debug` · `info` · `warn` · `error` |

Environment variables always override the TOML file.

---

## CLI Commands

```bash
vps-pilot                    # Start the HTTP server
vps-pilot install            # Interactive setup wizard (creates systemd unit + config)
vps-pilot adduser <username> # Create a local user (prompts for password)
vps-pilot help               # Show usage
```

---

## Install Wizard

The `vps-pilot install` command is the recommended way to deploy on a production Linux server. It:

1. Creates the `vps-pilot` system user (added to the `docker` group)
2. Creates `/var/lib/vps-pilot` and `/etc/vps-pilot` directories with correct permissions
3. Generates a random `cookie_secret` and writes a commented TOML config to `/etc/vps-pilot/config.toml`
4. Installs a hardened systemd unit (`/etc/systemd/system/vps-pilot.service`) with `ProtectSystem=strict`, `NoNewPrivileges=true`, and other security options
5. Enables and starts the service

```bash
sudo vps-pilot install
```

After installation, create the first local user:

```bash
sudo -u vps-pilot vps-pilot adduser admin
```

---

## Auth Modes

### PAM (`AUTH_MODE=pam`)
Authenticates against existing Linux system users via PAM. The process needs permission to call PAM (typically run as root, or add `CAP_AUDIT_WRITE`).

### Local (`AUTH_MODE=local`)
Users stored in SQLite, passwords hashed with argon2id. Create users with:
```bash
./vps-pilot adduser <username>
```

### Both (`AUTH_MODE=both`, default)
Tries PAM first; falls back to local. Useful for mixed environments.

---

## Docker Compose Projects

Place each project as a subdirectory under `PROJECTS_DIR`:
```
/opt/projects/
  myapp/
    docker-compose.yml
  nginx/
    docker-compose.yml
```

The manager detects any directory containing one of: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`.

Project actions (start/stop) call `docker compose up -d` / `docker compose down` in the project directory. The Docker CLI must be on `PATH`.

---

## Advanced Features

### Backup & Restore
Export and import the application state (SQLite database + Compose project files) as a ZIP archive. Backups include a metadata manifest for versioning.

### Cron Job Management
View and manage Linux crontab entries for system users directly from the web UI.

### Notifications
Configure notification channels (e.g. webhooks, email) to receive alerts when Docker events occur — container crashes (`container.die`), successful or failed deployments, etc.

### Secrets Management
Store sensitive values (API keys, passwords, tokens) encrypted at rest using AES-256-GCM. Secrets are decrypted in memory only when needed and never exposed in plaintext over the API.

### Roles & Permissions (RBAC)
Assign roles to users to control access to specific features (projects, files, secrets, admin, etc.).

### Webhooks
Configure outbound webhooks to notify external systems of events (deployments, backups, container state changes).

### Audit Log
All user actions (login, start/stop projects, secret access, user management) are recorded in the database with timestamps and actor identity. Viewable from the admin UI.

### Container File Browser
Browse and download files from inside running containers in addition to the host file browser.

### Docker Registry Management
Add and manage Docker registry credentials used for pulling private images across projects.

---

## Development

### Local dev (two-server setup)

The dev workflow runs two processes in parallel:
- **Go API** on `:8080` — `make dev-api`
- **Vite HMR** on `:5173` (proxies `/api` → `:8080`) — `make dev-web`

Run both at once:

```bash
make dev
# Open http://localhost:5173
```

If `internal/webapp/dist/` doesn't exist yet (first checkout), run `make web` once before `make dev-api`.

To run each process independently:
```bash
make dev-api   # Go API server only, port 8080
make dev-web   # Vite dev server only, port 5173
```

### Container dev environment

Spin up the server inside Debian (matches a production VPS):

```bash
# Build Linux binary + start docker compose
make dev-docker

# In another terminal — create a test user
make dev-docker-adduser USER=admin

# Open http://localhost:8080
```

To pick up code changes: `make dev-docker` again (rebuilds and restarts).

Test projects can be placed in `tests/projects/` (mounted as `/opt/projects` inside the container).

---

## Testing

```bash
# Run all unit and integration tests
make test

# With coverage report
make coverage
```

**Test tiers:**

| Tier | Location | What it tests |
|---|---|---|
| Unit | `internal/auth/`, `internal/files/`, `internal/config/`, `internal/sse/` | Pure logic, no I/O |
| Integration | `internal/db/`, `internal/api/` | Real SQLite in temp dir, full HTTP stack via `httptest` |

Tests use `config.SkipCSRF = true` to bypass CSRF validation. PAM tests are skipped on non-Linux (stub returns error).

---

## Building for Linux

The project uses `modernc.org/sqlite` (pure Go, no CGO), so cross-compilation requires no extra toolchain — just Go and Bun:

```bash
make build-linux      # → vps-pilot-linux-amd64
make build-linux-arm64  # → vps-pilot-linux-arm64
```

Both targets also build the React frontend first (`make web`). To skip the frontend rebuild (e.g. dist/ is already up to date):

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o vps-pilot-linux-amd64 ./cmd/server
```

---

## Deployment (systemd)

### Recommended: Install Wizard

```bash
sudo vps-pilot install
sudo -u vps-pilot vps-pilot adduser admin
```

### Manual deployment

```bash
# 1. Copy binary
sudo cp vps-pilot /usr/local/bin/

# 2. Create system user (must be in docker group for Docker socket access)
sudo useradd -r -s /sbin/nologin -G docker vps-pilot
sudo mkdir -p /var/lib/vps-pilot /etc/vps-pilot
sudo chown vps-pilot: /var/lib/vps-pilot

# 3. Write config file
sudo tee /etc/vps-pilot/config.toml <<EOF
cookie_secret = "$(openssl rand -hex 32)"
auth_mode = "both"
listen_addr = "0.0.0.0:8080"
data_dir = "/var/lib/vps-pilot"
projects_dir = "/opt/projects"
files_root = "/"
log_sink = "both"
log_level = "info"
EOF
sudo chmod 600 /etc/vps-pilot/config.toml

# 4. Install and start the service
sudo cp deploy/vps-pilot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vps-pilot

# 5. Create first local user
sudo -u vps-pilot /usr/local/bin/vps-pilot adduser admin
```

Check logs: `journalctl -u vps-pilot -f`

---

## Security Notes

- **Run behind a reverse proxy** (nginx, Caddy) for TLS termination, or configure `tls_cert`/`tls_key` directly.
- **cookie_secret** must be kept secret. Rotating it invalidates all active sessions.
- **files_root** should be the most restrictive path needed (e.g. `/home` or `/opt`) rather than `/`. Path traversal is blocked server-side regardless.
- **PAM auth** may require root or `CAP_AUDIT_WRITE`. If not needed, use `auth_mode = "local"`.
- **Docker socket** grants near-root access. The systemd unit runs as a dedicated user in the `docker` group.
- All POST endpoints are CSRF-protected via `gorilla/csrf`. The SPA includes the token via the `X-CSRF-Token` request header.
- **Secrets** are encrypted at rest with AES-256-GCM and are never returned in plaintext via the API.

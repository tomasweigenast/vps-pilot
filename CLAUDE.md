# VPS Manager

A slim Go HTTP server for managing a VPS focused on Docker Compose deployments. Single binary, systemd service, no runtime dependencies beyond Docker CLI.

## Stack

| Layer | Tech |
|---|---|
| HTTP | `chi` router |
| Templates | `templ` + HTMX + Tailwind CSS (CDN) |
| Database | SQLite via `mattn/go-sqlite3` (CGO) |
| Auth | Linux PAM + local argon2id users + `gorilla/securecookie` |
| CSRF | `gorilla/csrf` |
| Metrics | `gopsutil/v3` |
| Docker | Docker Engine API + `docker compose` CLI |
| SSE | stdlib `net/http` |

## Project Structure

```
cmd/server/main.go              Entry point + adduser CLI subcommand
internal/
  api/                          HTTP handlers and chi router
    router.go                   Route wiring, CSRF middleware
    auth.go                     Login/logout handlers
    system.go                   Metrics handlers + SSE broadcast
    docker.go                   Project list/start/stop/logs handlers
    files.go                    File browser handlers
    middleware.go               requireAuth middleware
    context.go                  Session context helpers
    respond.go                  JSON response helpers
    pipe.go                     io.Pipe helper for SSE log streaming
  auth/
    session.go                  Secure cookie (HKDF-derived keys)
    local.go                    Argon2id password hash/verify
    pam.go                      Linux PAM auth (linux build tag)
    pam_stub.go                 Non-linux stub
  config/config.go              Env-based config
  db/
    db.go                       SQLite open + auto-migrate
    users.go                    User CRUD
    migrations/                 SQL migration files
  docker/
    client.go                   Docker Engine client factory
    compose.go                  Project listing, start/stop, log streaming
  files/browser.go              Read-only file browser with traversal protection
  metrics/collector.go          gopsutil CPU/mem/disk/net snapshot
  sse/hub.go                    SSE broker with broadcast + ping
  web/templates/                Templ templates (compiled to *_templ.go)
deploy/vps-manager.service      Systemd unit
```

## Build

**Requires:** Go with CGO, GCC, `templ` CLI, Docker CLI on PATH.

```bash
# Install templ CLI (once)
go install github.com/a-h/templ/cmd/templ@latest

# Full build (generates templates then compiles)
make build

# Output: ./vps-manager (~17MB)
```

## Development

```bash
# Run API server (templates must already be generated)
make dev

# Regenerate templates after editing .templ files
make generate

# Lint
make lint
```

## Configuration

All config is via environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `COOKIE_SECRET` | required | 32-byte hex (`openssl rand -hex 32`) |
| `AUTH_MODE` | `both` | `pam` \| `local` \| `both` |
| `LISTEN_ADDR` | `0.0.0.0:8080` | HTTP listen address |
| `DATA_DIR` | `/var/lib/vps-manager` | SQLite + data directory |
| `PROJECTS_DIR` | `/opt/projects` | Docker Compose project root |
| `FILES_ROOT` | `/` | File browser root (users cannot browse above this) |
| `TLS_CERT` / `TLS_KEY` | empty | Optional TLS (blank = plain HTTP) |

## Bootstrap

```bash
# 1. Generate secret
export COOKIE_SECRET=$(openssl rand -hex 32)

# 2. Create first local user
./vps-manager adduser admin

# 3. Start server
./vps-manager
```

## Auth

- **PAM**: Authenticates against existing Linux system users. Requires the process to have PAM permissions (typically run as root or with `CAP_AUDIT_WRITE`).
- **Local**: Users stored in SQLite, passwords hashed with argon2id. Created via `vps-manager adduser`.
- **Both** (default): Tries PAM first, falls back to local.
- Sessions: signed+encrypted cookies (HKDF-derived keys from `COOKIE_SECRET`). 7-day expiry, HttpOnly, Secure, SameSite=Strict.
- CSRF: `gorilla/csrf` middleware on all routes. HTMX requests send token via `X-CSRF-Token` header (configured in base layout). Forms include hidden field `gorilla.csrf.Token`.

## Docker Compose Projects

Place compose projects as subdirectories under `PROJECTS_DIR`:
```
/opt/projects/
  myapp/
    docker-compose.yml
  nginx/
    docker-compose.yml
```

The manager detects any directory containing `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, or `compose.yaml`.

## File Browser

Read-only. Users can browse from `FILES_ROOT` down and download files. Path traversal (`../`) is blocked via `filepath.Rel` check.

## Metrics

Collected via `gopsutil`: CPU usage %, core count, memory used/total/available, disk usage per partition, network bytes/packets per interface. Broadcast via SSE every 2s to connected dashboard clients.

## Templates

Templates live in `internal/web/templates/*.templ`. After editing, run `make generate` (or `templ generate ./internal/web/templates/`) to produce `*_templ.go` files. **Never edit `*_templ.go` files directly.**

## Deployment (systemd)

```bash
# Copy binary
sudo cp vps-manager /usr/local/bin/

# Create system user
sudo useradd -r -s /sbin/nologin -G docker vps-manager
sudo mkdir -p /var/lib/vps-manager /etc/vps-manager
sudo chown vps-manager: /var/lib/vps-manager

# Write env file
sudo tee /etc/vps-manager/env <<EOF
COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_MODE=both
LISTEN_ADDR=0.0.0.0:8080
DATA_DIR=/var/lib/vps-manager
PROJECTS_DIR=/opt/projects
FILES_ROOT=/
EOF
sudo chmod 600 /etc/vps-manager/env

# Install and start service
sudo cp deploy/vps-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vps-manager
```

## Security Notes

- Run behind a TLS-terminating reverse proxy (nginx/caddy) or use `TLS_CERT`/`TLS_KEY`.
- The system user needs to be in the `docker` group to access the Docker socket.
- PAM auth may require running as root or granting specific capabilities — prefer local auth when PAM is not needed.
- `FILES_ROOT` should be set to the most restrictive path needed (e.g. `/home` or `/opt`) rather than `/`.

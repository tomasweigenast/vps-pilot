# VPS Manager

A Go HTTP server for managing a VPS focused on Docker Compose deployments. Single binary, systemd service, no runtime dependencies beyond Docker CLI.

## Stack

| Layer | Tech |
|---|---|
| HTTP | `chi` router |
| Frontend | Embedded SPA (`internal/webapp/dist/`) |
| Database | SQLite via `modernc.org/sqlite` (pure Go, no CGO) |
| Config | TOML file + env overrides (`BurntSushi/toml`) |
| Auth | Linux PAM + local argon2id users + `gorilla/securecookie` |
| CSRF | `gorilla/csrf` |
| Metrics | `gopsutil/v3` |
| Docker | Docker Engine API + `docker compose` CLI |
| SSE | stdlib `net/http` |
| WebSocket | `gorilla/websocket` |
| Secrets | AES-256-GCM (stdlib `crypto/aes`) |

## Project Structure

```
cmd/server/main.go              Entry point + adduser + install CLI subcommands
cmd/server/install.go           Interactive setup wizard (systemd unit + TOML config)
internal/
  api/                          HTTP handlers and chi router
    router.go                   Route wiring, CSRF middleware
    auth.go                     Login/logout handlers
    system.go                   Metrics handlers + SSE broadcast
    docker.go                   Project list/start/stop/logs handlers
    projects.go                 Project CRUD (SQLite-backed)
    containers.go               Container management handlers
    container_files.go          File browser inside running containers
    build.go                    Docker build management handlers
    resources.go                Container resource monitoring handlers
    registries.go               Docker registry credential management
    files.go                    Host file browser handlers
    logs.go                     Log streaming and history
    backup.go                   Backup export/import handlers
    cron.go                     Cron job management handlers
    notifications.go            Notification channel handlers
    secrets.go                  Encrypted secrets CRUD handlers
    roles.go                    RBAC role assignment handlers
    users.go                    User management handlers
    webhooks.go                 Outbound webhook handlers
    audit.go                    Audit log handlers
    setup.go                    First-run setup handlers
    ws.go                       WebSocket upgrade + message routing
    middleware.go               requireAuth, RBAC middleware
    context.go                  Session context helpers
    respond.go                  JSON response helpers
    jsonapi.go                  JSON:API helpers
    pipe.go                     io.Pipe helper for SSE log streaming
    static.go                   Embedded static asset handler
  auth/
    session.go                  Secure cookie (HKDF-derived keys)
    local.go                    Argon2id password hash/verify
    pam.go                      Linux PAM auth (linux build tag)
    pam_stub.go                 Non-linux stub
  backup/
    backup.go                   ZIP export/import (SQLite + Compose files + manifest)
  config/config.go              TOML + env-based config with defaults
  cron/
    manager.go                  Read/write user crontab entries via crontab(1)
    parser.go                   Cron expression parser and validator
  db/
    db.go                       SQLite open + auto-migrate
    users.go                    User CRUD
    migrations/                 SQL migration files
  docker/
    client.go                   Docker Engine client factory
    compose.go                  Project listing, start/stop, log streaming
    build.go                    Image build management
    containers.go               Container list, inspect, exec
    updates.go                  Image update checking
    resources.go                Container CPU/mem/net resource stats
    registries.go               Registry credential storage and auth
  files/browser.go              Read-only file browser with traversal protection
  logbuffer/
    buffer.go                   Thread-safe circular ring buffer (500 lines, fan-out)
    handler.go                  http.Handler adapter for log streaming
  metrics/collector.go          gopsutil CPU/mem/disk/net snapshot
  notify/
    notify.go                   Dispatch notifications to channels on Docker events
  secrets/
    crypto.go                   AES-256-GCM encrypt/decrypt for at-rest secrets
  sse/hub.go                    SSE broker with broadcast + ping
  users/
    linux.go                    Parse /etc/passwd to enumerate loginable system users
  webapp/
    embed.go                    Embed compiled SPA dist/ as Go filesystem
  ws/
    hub.go                      WebSocket connection hub (pub/sub broadcasting)
  web/templates/                Templ templates (compiled to *_templ.go)
deploy/vps-pilot.service      Systemd unit
```

## Build

**Requires:** Go 1.25+, [Bun](https://bun.sh). No CGO or GCC needed.

```bash
make web          # Build React SPA → internal/webapp/dist/
make build        # make web + go build → ./vps-pilot
make build-linux  # make web + cross-compile → vps-pilot-linux-amd64
make build-linux-arm64  # → vps-pilot-linux-arm64
```

## Development

Two servers run in parallel:
- Go API on `:8080` (`make dev-api`)
- Vite HMR on `:5173` — proxies `/api` → `:8080` (`make dev-web`)

```bash
make dev        # Both servers — open http://localhost:5173
make dev-api    # Go API only
make dev-web    # Vite only
make dev-docker # Build Linux binary + docker-compose.test.yml (Debian container)
make lint       # go vet
```

Run `make web` once on first checkout if `internal/webapp/dist/` doesn't exist.

## Configuration

Config is read from a TOML file (default: `/etc/vps-pilot/config.toml`) with environment variable overrides. If the file does not exist, env vars and hardcoded defaults are used (useful in tests/CI).

| Variable | TOML key | Default | Description |
|---|---|---|---|
| `COOKIE_SECRET` | `cookie_secret` | required | 32-byte hex (`openssl rand -hex 32`) |
| `AUTH_MODE` | `auth_mode` | `both` | `pam` \| `local` \| `both` |
| `LISTEN_ADDR` | `listen_addr` | `0.0.0.0:8080` | HTTP listen address |
| `DATA_DIR` | `data_dir` | `/var/lib/vps-pilot` | SQLite + data directory |
| `PROJECTS_DIR` | `projects_dir` | `/opt/projects` | Docker Compose project root |
| `FILES_ROOT` | `files_root` | `/` | File browser root |
| `TLS_CERT` | `tls_cert` | empty | Path to TLS certificate |
| `TLS_KEY` | `tls_key` | empty | Path to TLS private key |
| `LOG_SINK` | `log_sink` | `both` | Log destination: `stdout` \| `db` \| `both` |
| `LOG_LEVEL` | `log_level` | `info` | `debug` \| `info` \| `warn` \| `error` |

`config.DefaultConfigContent(d)` generates a fully-commented TOML template. `config.GenerateCookieSecret()` generates a random secret.

## CLI Commands

```bash
vps-pilot                    # Start the HTTP server
vps-pilot install            # Interactive setup wizard (systemd unit + config + user)
vps-pilot adduser <username> # Create a local user (prompts for password)
vps-pilot help               # Show usage
```

`vps-pilot install` (in `cmd/server/install.go`) creates the system user, directories, TOML config, and a hardened systemd unit (`ProtectSystem=strict`, `NoNewPrivileges=true`, etc.).

## Bootstrap

```bash
# 1. Generate secret
export COOKIE_SECRET=$(openssl rand -hex 32)

# 2. Create first local user
./vps-pilot adduser admin

# 3. Start server
./vps-pilot
```

Or for production:
```bash
sudo vps-pilot install
sudo -u vps-pilot vps-pilot adduser admin
```

## Auth

- **PAM**: Authenticates against existing Linux system users. Requires the process to have PAM permissions (typically run as root or with `CAP_AUDIT_WRITE`).
- **Local**: Users stored in SQLite, passwords hashed with argon2id. Created via `vps-pilot adduser`.
- **Both** (default): Tries PAM first, falls back to local.
- Sessions: signed+encrypted cookies (HKDF-derived keys from `cookie_secret`). 7-day expiry, HttpOnly, Secure, SameSite=Strict.
- CSRF: `gorilla/csrf` middleware on all routes. The SPA sends the token via the `X-CSRF-Token` request header.

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

Read-only. Users can browse from `FILES_ROOT` down and download files. Path traversal (`../`) is blocked via `filepath.Rel` check. A separate container file browser (`internal/api/container_files.go`) allows browsing files inside running Docker containers.

## Secrets

Stored in SQLite encrypted with AES-256-GCM (`internal/secrets/crypto.go`). The encryption key is derived from `cookie_secret`. Secrets are decrypted in memory only; never returned in plaintext over the API.

## Metrics

Collected via `gopsutil`: CPU usage %, core count, memory used/total/available, disk usage per partition, network bytes/packets per interface. Broadcast via SSE every 2s to connected dashboard clients.

## Real-time Communication

- **SSE** (`internal/sse/hub.go`): metrics broadcast, log streaming.
- **WebSocket** (`internal/ws/hub.go`): general-purpose pub/sub hub using `gorilla/websocket`. Clients subscribe to topics; the server pushes JSON messages.
- **Log buffer** (`internal/logbuffer/`): 500-line ring buffer with fan-out to multiple subscribers. Implements `io.Writer`.

## Notifications & Webhooks

- **Notifications** (`internal/notify/`): rule-based dispatch to configured channels when Docker events fire (`container.die`, `deploy.success`, `deploy.fail`, etc.).
- **Webhooks** (`internal/api/webhooks.go`): outbound HTTP callbacks to external systems on application events.

## Backup

`internal/backup/backup.go` exports the SQLite database (via `VACUUM INTO`) and all Compose project files into a ZIP archive with a metadata manifest. Restore unpacks and applies the manifest.

## Cron

`internal/cron/` reads and writes Linux crontab entries via the `crontab(1)` command. `parser.go` parses and validates cron expressions. The web UI lists jobs per user and allows creating/deleting entries.

## Frontend

The web UI is a compiled SPA embedded in the binary via `internal/webapp/embed.go`. The `dist/` folder is built separately and committed; Go's `embed.FS` serves it at runtime. There are no `.templ` files — the templ/HTMX approach has been replaced by the SPA.

## Deployment (systemd)

```bash
# Recommended
sudo vps-pilot install

# Manual (see README for full steps)
sudo cp vps-pilot /usr/local/bin/
sudo useradd -r -s /sbin/nologin -G docker vps-pilot
sudo cp deploy/vps-pilot.service /etc/systemd/system/
sudo systemctl enable --now vps-pilot
```

## Security Notes

- Run behind a TLS-terminating reverse proxy (nginx/caddy) or use `tls_cert`/`tls_key`.
- The system user needs to be in the `docker` group to access the Docker socket.
- PAM auth may require running as root or granting specific capabilities — prefer local auth when PAM is not needed.
- `files_root` should be set to the most restrictive path needed (e.g. `/home` or `/opt`) rather than `/`.
- Secrets are AES-256-GCM encrypted at rest and never returned in plaintext.

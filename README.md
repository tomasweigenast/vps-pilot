# vps-manager

A slim Go HTTP server for managing a VPS focused on Docker Compose deployments. Ships as a single self-contained binary (~17MB) with a server-side-rendered web UI (Templ + HTMX + Tailwind CSS).

**Features:** system metrics (CPU/mem/disk/net), Docker Compose project management (list/start/stop/logs), read-only file browser, dual authentication (Linux PAM + custom local users), CSRF protection, live SSE streaming.

---

## Prerequisites

| Tool | Purpose |
|---|---|
| Go 1.25+ with CGO enabled | Build |
| GCC | Required by `mattn/go-sqlite3` (CGO) |
| `templ` CLI | Template code generation |
| Docker + Docker CLI | Docker Compose project management at runtime |
| PAM dev headers *(optional)* | PAM auth on Linux (`libpam0g-dev` on Debian/Ubuntu) |

Install `templ`:
```bash
go install github.com/a-h/templ/cmd/templ@latest
```

---

## Quick Start

```bash
# 1. Build
make build

# 2. Generate a cookie secret
export COOKIE_SECRET=$(openssl rand -hex 32)

# 3. Create a local user
./vps-manager adduser admin

# 4. Start the server
./vps-manager
# → http://localhost:8080
```

---

## Configuration

All configuration is via environment variables. See `.env.example` for a template.

| Variable | Default | Description |
|---|---|---|
| `COOKIE_SECRET` | **required** | 32 random bytes as hex (`openssl rand -hex 32`) |
| `AUTH_MODE` | `both` | `pam` · `local` · `both` |
| `LISTEN_ADDR` | `0.0.0.0:8080` | HTTP listen address |
| `DATA_DIR` | `/var/lib/vps-manager` | SQLite database directory |
| `PROJECTS_DIR` | `/opt/projects` | Docker Compose project root |
| `FILES_ROOT` | `/` | File browser root (users cannot browse above this) |
| `TLS_CERT` | *(empty)* | Path to TLS certificate (optional) |
| `TLS_KEY` | *(empty)* | Path to TLS private key (optional) |

---

## CLI Commands

```bash
vps-manager                    # Start the HTTP server
vps-manager adduser <username> # Create a local user (prompts for password)
vps-manager help               # Show usage
```

---

## Auth Modes

### PAM (`AUTH_MODE=pam`)
Authenticates against existing Linux system users via PAM. The process needs permission to call PAM (typically run as root, or add `CAP_AUDIT_WRITE`).

### Local (`AUTH_MODE=local`)
Users stored in SQLite, passwords hashed with argon2id. Create users with:
```bash
./vps-manager adduser <username>
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

## Development

### Local server (native)

```bash
# Requires Go + GCC + templ CLI
make dev
# → Regenerates templates and runs the server at http://localhost:8080
```

After editing `.templ` files, run `make generate` to regenerate `*_templ.go` files. **Never edit `*_templ.go` directly.**

### Container dev environment

Spin up the server inside Debian (matches a production VPS) and debug via browser:

```bash
# Cross-compile for Linux (macOS → amd64 Linux)
# Requires: brew install FiloSottile/musl-cross/musl-cross
make build-linux

# Start the container
docker compose -f docker-compose.test.yml up

# In another terminal — create a test user
make dev-docker-adduser USER=admin

# Open http://localhost:8080
```

The binary is mounted read-only. To pick up code changes: `make build-linux` and restart the container.

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

## Building for Linux from macOS

The project uses CGO (`mattn/go-sqlite3`) so you need a Linux cross-compiler:

```bash
# Install musl cross-compiler via Homebrew
brew install FiloSottile/musl-cross/musl-cross

# Build
GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-linux-musl-gcc \
    go build -ldflags="-s -w -extldflags=-static" -o vps-manager-linux ./cmd/server
```

The resulting binary is statically linked and runs on any Linux amd64 system without glibc dependencies. `make build-linux` wraps this.

---

## Deployment (systemd)

```bash
# 1. Copy binary
sudo cp vps-manager /usr/local/bin/

# 2. Create system user (must be in docker group for Docker socket access)
sudo useradd -r -s /sbin/nologin -G docker vps-manager
sudo mkdir -p /var/lib/vps-manager /etc/vps-manager
sudo chown vps-manager: /var/lib/vps-manager

# 3. Write environment file
sudo tee /etc/vps-manager/env <<EOF
COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_MODE=both
LISTEN_ADDR=0.0.0.0:8080
DATA_DIR=/var/lib/vps-manager
PROJECTS_DIR=/opt/projects
FILES_ROOT=/
EOF
sudo chmod 600 /etc/vps-manager/env

# 4. Install and start the service
sudo cp deploy/vps-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vps-manager

# 5. Create first local user
sudo -u vps-manager /usr/local/bin/vps-manager adduser admin
```

Check logs: `journalctl -u vps-manager -f`

---

## Security Notes

- **Run behind a reverse proxy** (nginx, Caddy) for TLS termination, or configure `TLS_CERT`/`TLS_KEY` directly.
- **COOKIE_SECRET** must be kept secret. Rotating it invalidates all active sessions.
- **FILES_ROOT** should be the most restrictive path needed (e.g. `/home` or `/opt`) rather than `/`. Path traversal is blocked server-side regardless.
- **PAM auth** may require root or `CAP_AUDIT_WRITE`. If not needed, use `AUTH_MODE=local`.
- **Docker socket** grants near-root access. The systemd unit runs as a dedicated user in the `docker` group.
- All POST endpoints are CSRF-protected via `gorilla/csrf`. HTMX requests automatically include the token via the `X-CSRF-Token` header (injected by the base layout).

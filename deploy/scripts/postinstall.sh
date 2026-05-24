#!/usr/bin/env bash
# vps-pilot post-install script
# Runs after the package is installed by apt-get or apk.
# All steps are idempotent — safe to run multiple times.
set -euo pipefail

SERVICE_USER="vps-pilot"
CONFIG_DIR="/etc/vps-pilot"
CONFIG_FILE="$CONFIG_DIR/config.toml"
DATA_DIR="/var/lib/vps-pilot"
PROJECTS_DIR="/opt/projects"

# -- 1. System user -----------------------------------------------------------
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    echo "Created system user: $SERVICE_USER"
fi
# Always ensure docker group membership (idempotent).
if getent group docker &>/dev/null; then
    usermod -aG docker "$SERVICE_USER"
fi

# -- 2. Directories -----------------------------------------------------------
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
install -d -m 0755 -o root           -g root            "$CONFIG_DIR"
install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$PROJECTS_DIR"

# -- 3. Config file (never overwrite existing) --------------------------------
if [[ -f "$CONFIG_FILE" ]]; then
    echo "Config already exists at $CONFIG_FILE — skipping generation."
else
    # Migration: if the old env file exists, reuse its COOKIE_SECRET so
    # existing sessions are not invalidated.
    COOKIE_SECRET=""
    OLD_ENV="/etc/vps-pilot/env"
    if [[ -f "$OLD_ENV" ]]; then
        COOKIE_SECRET=$(grep -E '^COOKIE_SECRET=' "$OLD_ENV" | cut -d= -f2- | tr -d '"' || true)
        if [[ -n "$COOKIE_SECRET" ]]; then
            echo "Migrating COOKIE_SECRET from $OLD_ENV"
        fi
    fi

    if [[ -z "$COOKIE_SECRET" ]]; then
        COOKIE_SECRET=$(openssl rand -hex 32)
    fi

    # NOTE: Keep this template in sync with config.DefaultConfigContent() in
    # internal/config/config.go.
    cat > "$CONFIG_FILE" <<TOML
# vps-pilot configuration file
# Edit this file and restart the service to apply changes.
# Environment variables override individual settings (useful in CI/testing).
# See: https://github.com/tomasweigenast/vps-pilot

# cookie_secret: Required. 64-char hex-encoded 32-byte random value used to
# sign and encrypt session cookies. Changing this invalidates all sessions.
# Env override: COOKIE_SECRET
cookie_secret = "$COOKIE_SECRET"

# auth_mode: Authentication backend. Options: "pam", "local", "both".
# Env override: AUTH_MODE
auth_mode = "both"

# listen_addr: Address and port the HTTP server binds to.
# Env override: LISTEN_ADDR
listen_addr = "0.0.0.0:8080"

# data_dir: Directory for the SQLite database and internal state.
# Env override: DATA_DIR
data_dir = "/var/lib/vps-pilot"

# projects_dir: Root directory where Docker Compose projects live.
# Env override: PROJECTS_DIR
projects_dir = "/opt/projects"

# files_root: Root directory exposed by the file browser.
# Env override: FILES_ROOT
files_root = "/"

# tls_cert / tls_key: Paths to TLS certificate and key files.
# Env overrides: TLS_CERT, TLS_KEY
tls_cert = ""
tls_key  = ""

# log_sink: Where to write logs. Options: "stdout", "db", "both"
# Env override: LOG_SINK
log_sink = "both"

# log_level: Minimum log level. Options: "debug", "info", "warn", "error"
# Env override: LOG_LEVEL
log_level = "info"
TOML

    chmod 0600 "$CONFIG_FILE"
    echo "Generated config at $CONFIG_FILE"
fi

# -- 4. Systemd ---------------------------------------------------------------
if command -v systemctl &>/dev/null; then
    systemctl daemon-reload
    systemctl enable vps-pilot
    if systemctl is-active --quiet vps-pilot 2>/dev/null; then
        systemctl restart vps-pilot
        echo "Restarted vps-pilot service."
    else
        systemctl start vps-pilot
        echo "Started vps-pilot service."
    fi
fi

echo ""
echo "✓ vps-pilot installed successfully."
echo "  Config:  $CONFIG_FILE"
echo "  Data:    $DATA_DIR"
echo "  Logs:    journalctl -u vps-pilot -f"
echo ""
echo "  To create a local user:"
echo "    vps-pilot adduser <username>"
echo ""
echo "  Edit $CONFIG_FILE and run 'systemctl restart vps-pilot' to apply changes."

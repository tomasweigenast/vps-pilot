#!/usr/bin/env bash
# vps-pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/tomasweigenast/vps-pilot/main/deploy/install.sh | bash
#
# Environment variables:
#   VERSION   — specific release tag to install (default: latest)
#   INSTALL_FROM_LOCAL=1 — install from ./vps-pilot instead of downloading
set -euo pipefail

REPO="tomasweigenast/vps-pilot"
BINARY_NAME="vps-pilot"
INSTALL_PATH="/usr/local/bin/$BINARY_NAME"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# -- Helpers ------------------------------------------------------------------

info()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
err()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
    if [[ $EUID -ne 0 ]]; then
        err "This installer must be run as root (or with sudo)."
    fi
}

detect_distro() {
    if command -v apk &>/dev/null; then
        echo "alpine"
    elif command -v apt-get &>/dev/null; then
        echo "debian"
    else
        echo "unsupported"
    fi
}

detect_arch() {
    case "$(uname -m)" in
        x86_64)  echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) err "Unsupported architecture: $(uname -m)" ;;
    esac
}

resolve_version() {
    if [[ -n "${VERSION:-}" ]]; then
        echo "$VERSION"
        return
    fi
    # Fetch the latest release tag from GitHub API
    local tag
    tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    if [[ -z "$tag" ]]; then
        err "Could not determine latest version. Set VERSION env var to override."
    fi
    echo "$tag"
}

# -- Install binary -----------------------------------------------------------

install_binary() {
    if [[ "${INSTALL_FROM_LOCAL:-0}" == "1" ]]; then
        info "Installing from local binary..."
        if [[ ! -f "./$BINARY_NAME" ]]; then
            err "Local binary ./$BINARY_NAME not found. Run 'make build' first."
        fi
        install -o root -g root -m 0755 "./$BINARY_NAME" "$INSTALL_PATH"
        ok "Installed $INSTALL_PATH"
        return
    fi

    local version arch distro
    version=$(resolve_version)
    arch=$(detect_arch)
    distro=$(detect_distro)

    info "Installing vps-pilot $version ($arch) on $distro..."

    local base_url="https://github.com/$REPO/releases/download/$version"

    case "$distro" in
        alpine)
            local pkg="vps-pilot_${version}_linux_${arch}.apk"
            info "Downloading $pkg..."
            curl -fsSL "$base_url/$pkg" -o "$TMP_DIR/$pkg"
            apk add --allow-untrusted "$TMP_DIR/$pkg"
            ok "Installed via apk — postinstall already ran."
            return
            ;;
        debian)
            local pkg="vps-pilot_${version}_linux_${arch}.deb"
            info "Downloading $pkg..."
            curl -fsSL "$base_url/$pkg" -o "$TMP_DIR/$pkg"
            apt-get install -y "$TMP_DIR/$pkg"
            ok "Installed via apt-get — postinstall already ran."
            return
            ;;
        unsupported)
            # Tarball fallback: extract binary and run postinstall inline
            info "No supported package manager found — installing from tarball..."
            local tarball="vps-pilot_${version}_linux_${arch}.tar.gz"
            curl -fsSL "$base_url/$tarball" -o "$TMP_DIR/$tarball"
            tar -xz -C "$TMP_DIR" -f "$TMP_DIR/$tarball" "$BINARY_NAME"
            install -o root -g root -m 0755 "$TMP_DIR/$BINARY_NAME" "$INSTALL_PATH"
            ok "Installed $INSTALL_PATH"
            run_postinstall_inline
            return
            ;;
    esac
}

# -- Inline postinstall (tarball fallback path only) --------------------------
# When using .deb/.apk, the package's own postinstall.sh runs instead.

run_postinstall_inline() {
    local service_user="vps-pilot"
    local config_dir="/etc/vps-pilot"
    local config_file="$config_dir/config.toml"
    local data_dir="/var/lib/vps-pilot"
    local projects_dir="/opt/projects"

    info "Setting up system user..."
    if ! id "$service_user" &>/dev/null; then
        useradd --system --no-create-home --shell /usr/sbin/nologin "$service_user"
    fi
    if getent group docker &>/dev/null; then
        usermod -aG docker "$service_user"
    fi

    info "Creating directories..."
    install -d -m 0750 -o "$service_user" -g "$service_user" "$data_dir"
    install -d -m 0755 -o root -g root "$config_dir"
    install -d -m 0755 -o "$service_user" -g "$service_user" "$projects_dir"

    if [[ ! -f "$config_file" ]]; then
        info "Generating config file..."
        local cookie_secret=""
        local old_env="/etc/vps-pilot/env"
        if [[ -f "$old_env" ]]; then
            cookie_secret=$(grep -E '^COOKIE_SECRET=' "$old_env" | cut -d= -f2- | tr -d '"' || true)
        fi
        if [[ -z "$cookie_secret" ]]; then
            cookie_secret=$(openssl rand -hex 32)
        fi

        # NOTE: Keep in sync with config.DefaultConfigContent() in internal/config/config.go
        cat > "$config_file" <<TOML
# vps-pilot configuration file
# Edit this file and restart the service to apply changes.
cookie_secret = "$cookie_secret"
auth_mode = "both"
listen_addr = "0.0.0.0:8080"
data_dir = "/var/lib/vps-pilot"
projects_dir = "/opt/projects"
files_root = "/"
tls_cert = ""
tls_key  = ""
log_sink = "both"
log_level = "info"
TOML
        chmod 0600 "$config_file"
        ok "Generated $config_file"
    else
        info "Config already exists at $config_file — skipping."
    fi

    # Install systemd unit if we can find it beside this script
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local service_src="$script_dir/vps-pilot.service"
    if [[ -f "$service_src" ]] && command -v systemctl &>/dev/null; then
        cp "$service_src" /lib/systemd/system/vps-pilot.service
        systemctl daemon-reload
        systemctl enable vps-pilot
        if systemctl is-active --quiet vps-pilot 2>/dev/null; then
            systemctl restart vps-pilot
        else
            systemctl start vps-pilot
        fi
        ok "systemd service enabled and started."
    else
        info "systemd unit not installed automatically — copy deploy/vps-pilot.service manually."
    fi
}

# -- Main ---------------------------------------------------------------------

need_root
install_binary

echo ""
ok "vps-pilot installed."
echo "  Config:  /etc/vps-pilot/config.toml"
echo "  Data:    /var/lib/vps-pilot"
echo "  Logs:    journalctl -u vps-pilot -f"
echo ""
echo "  To create a local user:"
echo "    vps-pilot adduser <username>"
echo ""
echo "  Edit /etc/vps-pilot/config.toml and run 'systemctl restart vps-pilot' to apply changes."

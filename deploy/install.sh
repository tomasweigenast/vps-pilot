#!/usr/bin/env bash
# vps-pilot installer
# Usage: curl -fsSL https://raw.githubusercontent.com/tomasweigenast/vps-pilot/main/deploy/install.sh | bash
#
# Environment variables:
#   VERSION              - specific release tag to install (default: latest)
#   INSTALL_FROM_LOCAL=1 - install from ./vps-pilot instead of downloading
set -euo pipefail

REPO="tomasweigenast/vps-pilot"
INSTALL_PATH="/usr/local/bin/vps-pilot"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [[ $EUID -ne 0 ]]; then
    echo "error: run as root (sudo bash install.sh)" >&2
    exit 1
fi

detect_arch() {
    case "$(uname -m)" in
        x86_64)        echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *) echo "error: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac
}

resolve_version() {
    [[ -n "${VERSION:-}" ]] && { echo "$VERSION"; return; }
    curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep '"tag_name"' | head -1 \
        | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/'
}

if [[ "${INSTALL_FROM_LOCAL:-0}" == "1" ]]; then
    [[ -f "./vps-pilot" ]] || { echo "error: ./vps-pilot not found. Run 'make build-linux' first." >&2; exit 1; }
    install -o root -g root -m 0755 "./vps-pilot" "$INSTALL_PATH"
else
    ARCH=$(detect_arch)
    VERSION=$(resolve_version)
    echo "Downloading vps-pilot $VERSION ($ARCH)..."
    curl -fsSL "https://github.com/$REPO/releases/download/$VERSION/vps-pilot_${VERSION}_linux_${ARCH}.tar.gz" \
        | tar -xz -C "$TMP"
    install -o root -g root -m 0755 "$TMP/vps-pilot" "$INSTALL_PATH"
fi

echo "Binary installed to $INSTALL_PATH"
echo ""
vps-pilot install

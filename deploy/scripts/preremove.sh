#!/usr/bin/env bash
# vps-pilot pre-remove script
# Runs before the package is removed by apt-get or apk.
set -euo pipefail

if command -v systemctl &>/dev/null; then
    systemctl stop vps-pilot 2>/dev/null || true
    systemctl disable vps-pilot 2>/dev/null || true
    systemctl daemon-reload
fi

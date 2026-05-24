#!/usr/bin/env bash
# vps-pilot release helper
#
# Commands:
#   ./scripts/release.sh latest           — print the latest git tag
#   ./scripts/release.sh create v1.2.3   — create and push an annotated tag
set -euo pipefail

CMD="${1:-}"

case "$CMD" in
    latest)
        git describe --tags --abbrev=0
        ;;
    create)
        VERSION="${2:-}"
        if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Usage: release.sh create v<major>.<minor>.<patch>" >&2
            echo "Example: release.sh create v1.2.3" >&2
            exit 1
        fi

        # Ensure working tree is clean
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
            exit 1
        fi

        # Ensure we're on main branch
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        if [[ "$BRANCH" != "main" ]]; then
            echo "Warning: you are on branch '$BRANCH', not 'main'."
            read -r -p "Continue anyway? [y/N] " confirm
            if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi

        echo "Creating tag $VERSION..."
        git tag -a "$VERSION" -m "Release $VERSION"
        git push origin "$VERSION"
        echo ""
        echo "✓ Tag $VERSION pushed."
        echo "  GitHub Actions will build and publish the release automatically."
        echo "  Track progress at: https://github.com/tomasweigenast/vps-pilot/actions"
        ;;
    *)
        echo "Usage: release.sh <latest|create> [version]"
        echo ""
        echo "Commands:"
        echo "  latest           Print the latest release tag"
        echo "  create v1.2.3   Create and push an annotated tag (triggers CI release)"
        exit 1
        ;;
esac

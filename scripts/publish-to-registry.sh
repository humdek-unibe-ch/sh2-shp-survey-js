#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0
#
# Publish the current plugin version to the sibling sh2-plugin-registry repo.
#
# Usage:
#   ./scripts/publish-to-registry.sh [--registry PATH] [--channel stable|beta|alpha|nightly]
#                                    [--trust official|reviewed|untrusted]
#                                    [--dry-run] [--push] [--publish-npm] [--skip-build]
#
# See ./publish-to-registry.ps1 for the PowerShell equivalent and full
# documentation. Logic is intentionally kept identical between the two
# scripts so plugin maintainers on either platform observe the same
# behaviour.

set -euo pipefail

REGISTRY_PATH=""
CHANNEL="stable"
TRUST_LEVEL=""
DRY_RUN="0"
PUSH="0"
PUBLISH_NPM="0"
SKIP_BUILD="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --registry)     REGISTRY_PATH="$2"; shift 2 ;;
        --channel)      CHANNEL="$2"; shift 2 ;;
        --trust)        TRUST_LEVEL="$2"; shift 2 ;;
        --dry-run)      DRY_RUN="1"; shift ;;
        --push)         PUSH="1"; shift ;;
        --publish-npm)  PUBLISH_NPM="1"; shift ;;
        --skip-build)   SKIP_BUILD="1"; shift ;;
        -h|--help)
            sed -n '7,18p' "$0"
            exit 0 ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1 ;;
    esac
done

step()    { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()      { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn()    { printf '    \033[33m!!\033[0m  %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_JSON="$PLUGIN_ROOT/plugin.json"

[[ -f "$PLUGIN_JSON" ]] || { echo "plugin.json not found at $PLUGIN_JSON"; exit 1; }

if [[ -z "$REGISTRY_PATH" ]]; then
    REGISTRY_PATH="$(cd "$PLUGIN_ROOT/../sh2-plugin-registry" 2>/dev/null && pwd || true)"
fi
[[ -d "$REGISTRY_PATH" ]] || { echo "Registry path '$REGISTRY_PATH' not found. Pass --registry."; exit 1; }

if ! command -v jq >/dev/null 2>&1; then
    echo "This script requires 'jq' on PATH (https://jqlang.github.io/jq/)."
    exit 1
fi

PLUGIN_ID="$(jq -r '.id' "$PLUGIN_JSON")"
VERSION="$(jq -r '.version' "$PLUGIN_JSON")"
NAME="$(jq -r '.name' "$PLUGIN_JSON")"
DESCRIPTION="$(jq -r '.description // ""' "$PLUGIN_JSON")"
HOMEPAGE="$(jq -r '.homepage // ""' "$PLUGIN_JSON")"
if [[ -z "$TRUST_LEVEL" ]]; then
    TRUST_LEVEL="$(jq -r '.security.trustLevel // "untrusted"' "$PLUGIN_JSON")"
fi

step "Plugin id:       $PLUGIN_ID"
step "Plugin version:  $VERSION"
step "Registry path:   $REGISTRY_PATH"
step "Trust level:     $TRUST_LEVEL"
step "Channel:         $CHANNEL"

SCHEMA="$PLUGIN_ROOT/docs/plugins/plugin-manifest.schema.json"
if [[ -f "$SCHEMA" ]]; then
    if command -v ajv >/dev/null 2>&1; then
        step "Validating manifest against vendored schema"
        ajv validate -c ajv-formats -s "$SCHEMA" -d "$PLUGIN_JSON" --strict=false
        ok "Manifest passes schema."
    else
        warn "ajv-cli not on PATH. Skipping schema validation."
    fi
else
    warn "No vendored schema at $SCHEMA. Skipping validation."
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
    step "Building plugin frontend"
    ( cd "$PLUGIN_ROOT/frontend" && npm install --legacy-peer-deps >/dev/null && npm run build )
    ok "Frontend build done."

    step "Building plugin mobile"
    ( cd "$PLUGIN_ROOT/mobile" && npm install --legacy-peer-deps >/dev/null && npm run build )
    ok "Mobile build done."
fi

if [[ "$PUBLISH_NPM" == "1" ]]; then
    step "Publishing frontend npm package"
    ( cd "$PLUGIN_ROOT/frontend" && npm publish --access public )
    step "Publishing mobile npm package"
    ( cd "$PLUGIN_ROOT/mobile" && npm publish --access public )
    ok "npm packages published."
fi

MANIFESTS_DIR="$REGISTRY_PATH/manifests"
mkdir -p "$MANIFESTS_DIR"
DEST="$MANIFESTS_DIR/${PLUGIN_ID}-${VERSION}.json"

if [[ "$DRY_RUN" == "1" ]]; then
    warn "[dry-run] would copy $PLUGIN_JSON -> $DEST"
else
    cp "$PLUGIN_JSON" "$DEST"
    ok "Copied manifest to $DEST"
fi

REGISTRY_JSON="$REGISTRY_PATH/registry.json"
[[ -f "$REGISTRY_JSON" ]] || { echo "registry.json not found at $REGISTRY_JSON. Bootstrap the registry repo first."; exit 1; }

ENTRY=$(jq -n \
    --arg id          "$PLUGIN_ID" \
    --arg name        "$NAME" \
    --arg description "$DESCRIPTION" \
    --arg version     "$VERSION" \
    --arg channel     "$CHANNEL" \
    --arg trust       "$TRUST_LEVEL" \
    --arg homepage    "$HOMEPAGE" \
    --arg manifestUrl "manifests/${PLUGIN_ID}-${VERSION}.json" \
    '{ id: $id, name: $name, description: $description, version: $version, channel: $channel, trustLevel: $trust, homepage: $homepage, manifestUrl: $manifestUrl }')

NEW_JSON=$(jq --argjson entry "$ENTRY" --arg id "$PLUGIN_ID" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
    .publishedAt = $ts
    | .plugins   = ((.plugins // []) | map(select(.id != $id))) + [$entry]
    | .plugins   = (.plugins | sort_by(.id))
' "$REGISTRY_JSON")

if [[ "$DRY_RUN" == "1" ]]; then
    warn "[dry-run] would update $REGISTRY_JSON. Diff preview:"
    echo "$NEW_JSON"
else
    echo "$NEW_JSON" > "$REGISTRY_JSON"
    ok "Updated $REGISTRY_JSON"

    ( cd "$REGISTRY_PATH"
      git add registry.json "manifests/${PLUGIN_ID}-${VERSION}.json"
      git commit -m "publish: ${PLUGIN_ID}@${VERSION} ($CHANNEL/$TRUST_LEVEL)"
      ok "Committed in $REGISTRY_PATH."

      if [[ "$PUSH" == "1" ]]; then
          git push
          ok "Pushed to origin."
      fi
    )
fi

echo ""
echo -e "\033[32mDONE.\033[0m"
echo "Registry entry: $REGISTRY_JSON"
echo "Manifest file:  $DEST"
[[ "$PUSH" == "1" ]] || echo "Hint: re-run with --push to push the registry commit to origin."

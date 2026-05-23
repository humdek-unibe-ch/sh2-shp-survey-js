#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0
#
# Publish this plugin version to the sibling sh2-plugin-registry repo.
#
# Pipeline:
#   1. build-shplugin.{sh,mjs}        — produces dist/<id>-<ver>.shplugin +
#                                       canonical signed payload + signature.
#   2. selfhelp-plugin-build-registry-entry — emits the signed pluginEntry JSON
#                                       (consumes the same signed payload, so
#                                       the registry entry and the archive are
#                                       signed exactly once).
#   3. Copies plugin.json to <registry>/manifests/<id>-<ver>.json.
#   4. Copies dist/shplugin/<id>-<ver>/artifacts/* to
#      <registry>/artifacts/<id>-<ver>/.
#   5. Splices the registry entry into <registry>/registry.json (replacing
#      any existing entry with the same id) and re-sorts by id.
#   6. git add + commit (push optional).
#   7. Optional: gh release create v<ver> dist/<id>-<ver>.shplugin
#      --notes-file CHANGELOG.md
#
# Usage:
#   ./scripts/publish-to-registry.sh [--registry PATH] [--channel stable|beta|alpha|nightly]
#                                    [--dry-run] [--push] [--release] [--skip-build]
#
# Required env (one of):
#   SELFHELP_PLUGIN_SIGNING_KEY        (+ SELFHELP_PLUGIN_SIGNING_KEY_ID)
#   SELFHELP_PLUGIN_DEV_SIGNING_KEY    (local dev only — keyId=dev; CI rejects it on
#                                       the `official` channel).

set -euo pipefail

REGISTRY_PATH=""
CHANNEL="stable"
DRY_RUN="0"
PUSH="0"
RELEASE="0"
SKIP_BUILD="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --registry)   REGISTRY_PATH="$2"; shift 2 ;;
        --channel)    CHANNEL="$2"; shift 2 ;;
        --dry-run)    DRY_RUN="1"; shift ;;
        --push)       PUSH="1"; shift ;;
        --release)    RELEASE="1"; shift ;;
        --skip-build) SKIP_BUILD="1"; shift ;;
        -h|--help)
            sed -n '7,32p' "$0"
            exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn() { printf '    \033[33m!!\033[0m  %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_JSON="$PLUGIN_ROOT/plugin.json"

[[ -f "$PLUGIN_JSON" ]] || { echo "plugin.json not found at $PLUGIN_JSON"; exit 1; }

if [[ -z "$REGISTRY_PATH" ]]; then
    REGISTRY_PATH="$(cd "$PLUGIN_ROOT/../sh2-plugin-registry" 2>/dev/null && pwd || true)"
fi
[[ -d "$REGISTRY_PATH" ]] || { echo "Registry path '$REGISTRY_PATH' not found. Pass --registry."; exit 1; }

command -v node >/dev/null 2>&1 || { echo "node is required."; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "jq is required (https://jqlang.github.io/jq/)."; exit 1; }

PLUGIN_ID="$(jq -r '.id'      "$PLUGIN_JSON")"
VERSION="$(jq -r   '.version' "$PLUGIN_JSON")"
ARCHIVE="$PLUGIN_ROOT/dist/${PLUGIN_ID}-${VERSION}.shplugin"
STAGE="$PLUGIN_ROOT/dist/shplugin/${PLUGIN_ID}-${VERSION}"

step "Plugin id:       $PLUGIN_ID"
step "Plugin version:  $VERSION"
step "Registry path:   $REGISTRY_PATH"
step "Channel:         $CHANNEL"

BUILD_ARGS=()
[[ "$SKIP_BUILD" == "1" ]] && BUILD_ARGS+=("--skip-build")
step "Building .shplugin archive"
node "$SCRIPT_DIR/build-shplugin.mjs" "${BUILD_ARGS[@]}"
[[ -f "$ARCHIVE" ]] || { echo "Expected archive missing: $ARCHIVE"; exit 1; }
ok "Built $ARCHIVE"

ESM_HASH="$(sha256sum "$STAGE/artifacts/plugin.esm.js" | awk '{print $1}')"
CSS_HASH=""
if [[ -f "$STAGE/artifacts/plugin.css" ]]; then
    CSS_HASH="$(sha256sum "$STAGE/artifacts/plugin.css" | awk '{print $1}')"
fi

ENTRYPOINT_URL="artifacts/${PLUGIN_ID}-${VERSION}/plugin.esm.js"
STYLESHEET_URL=""
[[ -n "$CSS_HASH" ]] && STYLESHEET_URL="artifacts/${PLUGIN_ID}-${VERSION}/plugin.css"

step "Generating signed registry entry"
ENTRY_ARGS=(
    "$REGISTRY_PATH/scripts/build-registry-entry.mjs"
    --manifest "$PLUGIN_JSON"
    --esm "$STAGE/artifacts/plugin.esm.js"
    --entrypoint-url "$ENTRYPOINT_URL"
    --channel "$CHANNEL"
)
if [[ -n "$CSS_HASH" ]]; then
    ENTRY_ARGS+=(--css "$STAGE/artifacts/plugin.css" --stylesheet-url "$STYLESHEET_URL")
fi
ENTRY_JSON="$(node "${ENTRY_ARGS[@]}")"
ok "Registry entry signed."

DEST_MANIFEST="$REGISTRY_PATH/manifests/${PLUGIN_ID}-${VERSION}.json"
DEST_ARTIFACTS="$REGISTRY_PATH/artifacts/${PLUGIN_ID}-${VERSION}"

if [[ "$DRY_RUN" == "1" ]]; then
    warn "[dry-run] would copy plugin.json -> $DEST_MANIFEST"
    warn "[dry-run] would copy artifacts/* -> $DEST_ARTIFACTS"
    warn "[dry-run] would splice signed entry into $REGISTRY_PATH/registry.json"
    echo "$ENTRY_JSON"
    exit 0
fi

mkdir -p "$(dirname "$DEST_MANIFEST")" "$DEST_ARTIFACTS"
cp "$PLUGIN_JSON" "$DEST_MANIFEST"
cp "$STAGE/artifacts/plugin.esm.js" "$DEST_ARTIFACTS/plugin.esm.js"
[[ -n "$CSS_HASH" ]] && cp "$STAGE/artifacts/plugin.css" "$DEST_ARTIFACTS/plugin.css"
ok "Copied manifest + artifacts."

REGISTRY_JSON="$REGISTRY_PATH/registry.json"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NEW_JSON="$(jq --argjson entry "$ENTRY_JSON" --arg id "$PLUGIN_ID" --arg ts "$TS" '
    .publishedAt = $ts
    | .plugins   = ((.plugins // []) | map(select(.id != $id))) + [$entry]
    | .plugins   = (.plugins | sort_by(.id))
' "$REGISTRY_JSON")"
printf '%s\n' "$NEW_JSON" > "$REGISTRY_JSON"
ok "Updated $REGISTRY_JSON"

(
    cd "$REGISTRY_PATH"
    git add registry.json "manifests/${PLUGIN_ID}-${VERSION}.json" "artifacts/${PLUGIN_ID}-${VERSION}/"
    git commit -m "publish: ${PLUGIN_ID}@${VERSION} (${CHANNEL})"
    ok "Committed in $REGISTRY_PATH."
    if [[ "$PUSH" == "1" ]]; then
        git push
        ok "Pushed registry to origin."
    fi
)

if [[ "$RELEASE" == "1" ]]; then
    command -v gh >/dev/null 2>&1 || { echo "--release requires the gh CLI."; exit 1; }
    NOTES=()
    [[ -f "$PLUGIN_ROOT/CHANGELOG.md" ]] && NOTES+=("--notes-file" "$PLUGIN_ROOT/CHANGELOG.md")
    step "Creating GitHub Release v${VERSION}"
    (cd "$PLUGIN_ROOT" && gh release create "v${VERSION}" "$ARCHIVE" "${NOTES[@]}")
    ok "Release published; .shplugin attached as asset."
fi

echo ""
echo -e "\033[32mDONE.\033[0m"
echo "Archive:        $ARCHIVE"
echo "Registry entry: $REGISTRY_JSON"
echo "Manifest copy:  $DEST_MANIFEST"
echo "Artifacts dir:  $DEST_ARTIFACTS"
[[ "$PUSH" == "1" ]] || echo "Hint: re-run with --push to push the registry commit to origin."
[[ "$RELEASE" == "1" ]] || echo "Hint: re-run with --release to also publish the .shplugin as a GH Release asset."

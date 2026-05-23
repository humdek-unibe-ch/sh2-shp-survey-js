#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0
#
# One-shot local installer. Mirrors install-local.ps1.
#
# Default flow (.shplugin upload):
#   1. scripts/build-shplugin.mjs            — produce signed .shplugin
#   2. POST .shplugin to the host install endpoint (multipart/form-data,
#      source=archive). Host queues an InstallPluginMessage.
#   3. php bin/console messenger:consume plugin_ops --limit=1 --time-limit=120
#      drains the queue inline.
#
# --symlink fast-path:
#   1. composer config repositories.<id> path <plugin>/backend
#   2. composer require humdek/<id>:@dev
#   3. php bin/console selfhelp:plugin:install <plugin.json>
#   4. messenger:consume (unless --skip-consume)
#
# Required env (default flow): SELFHELP_ADMIN_TOKEN (or --token).

set -euo pipefail

BACKEND_PATH=""
API_BASE="http://localhost:8000"
TOKEN=""
SYMLINK="0"
SKIP_BUILD="0"
SKIP_CONSUME="0"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)      BACKEND_PATH="$2"; shift 2 ;;
        --api-base)     API_BASE="$2";     shift 2 ;;
        --token)        TOKEN="$2";        shift 2 ;;
        --symlink)      SYMLINK="1";       shift ;;
        --skip-build)   SKIP_BUILD="1";    shift ;;
        --skip-consume) SKIP_CONSUME="1";  shift ;;
        -h|--help)
            sed -n '7,29p' "$0"
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

if [[ -z "$BACKEND_PATH" ]]; then
    BACKEND_PATH="$(cd "$PLUGIN_ROOT/../../sh-selfhelp_backend" 2>/dev/null && pwd || true)"
fi
[[ -d "$BACKEND_PATH" ]] || { echo "Backend path '$BACKEND_PATH' not found. Pass --backend."; exit 1; }

command -v jq >/dev/null 2>&1 || { echo "jq is required."; exit 1; }
PLUGIN_ID="$(jq -r '.id'      "$PLUGIN_JSON")"
VERSION="$(jq -r   '.version' "$PLUGIN_JSON")"

step "Plugin:        $PLUGIN_ID@$VERSION"
step "Backend path:  $BACKEND_PATH"
step "Mode:          $([[ "$SYMLINK" == "1" ]] && echo 'symlink (dev)' || echo '.shplugin upload')"

if [[ "$SYMLINK" == "1" ]]; then
    BACKEND_DIR="$PLUGIN_ROOT/backend"
    [[ -d "$BACKEND_DIR" ]] || { echo "Plugin backend dir not found: $BACKEND_DIR"; exit 1; }
    step "Wiring composer path repo"
    (
        cd "$BACKEND_PATH"
        composer config "repositories.selfhelp/$PLUGIN_ID" path "$BACKEND_DIR" >/dev/null
        composer require "humdek/$PLUGIN_ID:@dev" --no-interaction
        ok "Composer path repo registered + bundle required."

        step "Invoking host CLI installer"
        php bin/console selfhelp:plugin:install "$PLUGIN_JSON"
        ok "selfhelp:plugin:install dispatched."

        if [[ "$SKIP_CONSUME" != "1" ]]; then
            step "Draining plugin_ops Messenger queue"
            php bin/console messenger:consume plugin_ops --limit=1 --time-limit=120
            ok "Plugin installed + finalised."
        else
            warn "Skipped messenger:consume (--skip-consume)."
        fi
    )
    echo ""
    echo -e "\033[32mDONE (symlink mode).\033[0m"
    echo "Start the frontend runtime dev server:"
    echo "  npm --prefix $PLUGIN_ROOT/frontend run dev:runtime"
    exit 0
fi

if [[ -z "$TOKEN" && -n "${SELFHELP_ADMIN_TOKEN:-}" ]]; then
    TOKEN="$SELFHELP_ADMIN_TOKEN"
fi
[[ -n "$TOKEN" ]] || { echo "Admin JWT required. Pass --token or set SELFHELP_ADMIN_TOKEN."; exit 1; }

step "Building .shplugin archive"
BUILD_ARGS=("$SCRIPT_DIR/build-shplugin.mjs")
[[ "$SKIP_BUILD" == "1" ]] && BUILD_ARGS+=("--skip-build")
node "${BUILD_ARGS[@]}"
ARCHIVE="$PLUGIN_ROOT/dist/$PLUGIN_ID-$VERSION.shplugin"
[[ -f "$ARCHIVE" ]] || { echo "Expected archive missing: $ARCHIVE"; exit 1; }
ok "Built $ARCHIVE"

step "Uploading .shplugin to $API_BASE/cms-api/v1/admin/plugins/install"
RESP="$(curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer $TOKEN" \
    -F "source=archive" \
    -F "archive=@$ARCHIVE" \
    "$API_BASE/cms-api/v1/admin/plugins/install")"
OP_ID="$(echo "$RESP" | jq -r '.data.id')"
ok "Operation #$OP_ID queued."

if [[ "$SKIP_CONSUME" == "1" ]]; then
    warn "Skipped messenger:consume (--skip-consume)."
else
    step "Draining plugin_ops Messenger queue"
    (cd "$BACKEND_PATH" && php bin/console messenger:consume plugin_ops --limit=1 --time-limit=120)
    ok "Plugin install operation finalised."
fi

echo ""
echo -e "\033[32mDONE.\033[0m"
echo "Verify: $API_BASE/admin/plugins"

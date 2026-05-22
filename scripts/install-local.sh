#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0
#
# One-shot local installer for the sh2-shp-survey-js plugin.
# See ./install-local.ps1 for the PowerShell equivalent.
#
# Usage:
#   ./install-local.sh
#   ./install-local.sh --backend /abs/path --frontend /abs/path --mobile /abs/path
#   ./install-local.sh --skip-composer       # if composer is unavailable
#   ./install-local.sh --skip-npm-link       # if packages are already linked
#   ./install-local.sh --mobile ''           # skip the mobile linking step
#

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLUGIN_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
PLUGIN_MANIFEST="$PLUGIN_ROOT/plugin.json"

BACKEND_PATH=""
FRONTEND_PATH=""
MOBILE_PATH=""
SKIP_COMPOSER=0
SKIP_NPM_LINK=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backend)        BACKEND_PATH="$2";  shift 2 ;;
        --frontend)       FRONTEND_PATH="$2"; shift 2 ;;
        --mobile)         MOBILE_PATH="$2";   shift 2 ;;
        --skip-composer)  SKIP_COMPOSER=1;    shift   ;;
        --skip-npm-link)  SKIP_NPM_LINK=1;    shift   ;;
        -h|--help)
            sed -n '1,30p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$BACKEND_PATH" ]]; then
    BACKEND_PATH="$( cd "$PLUGIN_ROOT/../../sh-selfhelp_backend" 2>/dev/null && pwd || true )"
fi
if [[ -z "$FRONTEND_PATH" ]]; then
    FRONTEND_PATH="$( cd "$PLUGIN_ROOT/../../sh-selfhelp_frontend" 2>/dev/null && pwd || true )"
fi
if [[ -z "$MOBILE_PATH" ]]; then
    MOBILE_PATH="$( cd "$PLUGIN_ROOT/../../sh-selfhelp_mobile" 2>/dev/null && pwd || true )"
fi

if [[ ! -f "$PLUGIN_MANIFEST" ]]; then
    echo "plugin.json not found at $PLUGIN_MANIFEST" >&2
    exit 1
fi
if [[ -z "$BACKEND_PATH" || ! -d "$BACKEND_PATH" ]]; then
    echo "Backend path '$BACKEND_PATH' not found. Pass --backend /abs/path." >&2
    exit 1
fi

step() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m    OK  %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    !!  %s\033[0m\n' "$1"; }

step "Plugin root:     $PLUGIN_ROOT"
step "Backend path:    $BACKEND_PATH"
step "Frontend path:   ${FRONTEND_PATH:-<skipped>}"
step "Mobile path:     ${MOBILE_PATH:-<skipped>}"

# ---------------------------------------------------------------
# Step 1: composer path repo + require
# ---------------------------------------------------------------
if [[ $SKIP_COMPOSER -eq 0 ]]; then
    step "Linking backend bundle via Composer path repo"
    (
        cd "$BACKEND_PATH"
        composer config "repositories.selfhelp/sh2-shp-survey-js" path "$PLUGIN_ROOT/backend"
        composer require "humdek/sh2-shp-survey-js:@dev"
    )
    ok "Composer path repo registered and package required."
else
    warn "Skipped Composer step (--skip-composer)."
fi

# ---------------------------------------------------------------
# Step 2: backend install
# ---------------------------------------------------------------
step "Calling backend installer"
(
    cd "$BACKEND_PATH"
    php bin/console selfhelp:plugin:install "$PLUGIN_MANIFEST"
)
ok "Backend install command finished."

# ---------------------------------------------------------------
# Step 3: npm link for frontend
# ---------------------------------------------------------------
if [[ $SKIP_NPM_LINK -eq 0 && -n "$FRONTEND_PATH" ]]; then
    step "Linking frontend npm package"
    (
        cd "$PLUGIN_ROOT/frontend"
        npm install --legacy-peer-deps
        npm run build
        npm link
    )
    (
        cd "$FRONTEND_PATH"
        npm link "@humdek/sh2-shp-survey-js"
    )
    ok "Host frontend now resolves @humdek/sh2-shp-survey-js from $PLUGIN_ROOT/frontend."
fi

# ---------------------------------------------------------------
# Step 4: npm link for mobile (optional)
# ---------------------------------------------------------------
if [[ $SKIP_NPM_LINK -eq 0 && -n "$MOBILE_PATH" && -d "$MOBILE_PATH" ]]; then
    step "Linking mobile npm package"
    (
        cd "$PLUGIN_ROOT/mobile"
        npm install --legacy-peer-deps
        npm link
    )
    (
        cd "$MOBILE_PATH"
        npm link "@humdek/sh2-shp-survey-js-mobile"
    )
    ok "Host mobile now resolves @humdek/sh2-shp-survey-js-mobile from $PLUGIN_ROOT/mobile."
elif [[ -z "$MOBILE_PATH" ]]; then
    warn "Mobile path empty — skipped mobile link step."
fi

echo ""
echo -e "\033[32mDONE.\033[0m"
echo "The plugin is installed and enabled. If your dev servers are running"
echo "they will pick the changes up via HMR automatically:"
echo "  - Symfony: kernel reloads on next request."
echo "  - Next.js: a hard refresh of the admin page is enough."
echo "  - Expo:    re-press 'r' in the metro terminal if it does not auto-reload."

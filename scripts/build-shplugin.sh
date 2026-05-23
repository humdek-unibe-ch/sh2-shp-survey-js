#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0
#
# Build the sh2-shp-survey-js .shplugin archive.
#
# Thin wrapper around scripts/build-shplugin.mjs. Required env (one of):
#   SELFHELP_PLUGIN_SIGNING_KEY        (production; also SELFHELP_PLUGIN_SIGNING_KEY_ID)
#   SELFHELP_PLUGIN_DEV_SIGNING_KEY    (local dev, keyId=dev)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_ARGS=("$SCRIPT_DIR/build-shplugin.mjs")

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) NODE_ARGS+=("--skip-build"); shift ;;
        -h|--help)
            cat <<EOF
Usage: $(basename "$0") [--skip-build]

Required env (one of):
  SELFHELP_PLUGIN_SIGNING_KEY       (production)
  SELFHELP_PLUGIN_DEV_SIGNING_KEY   (local dev, keyId=dev)
EOF
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

exec node "${NODE_ARGS[@]}"

# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0

<#
.SYNOPSIS
    Builds the sh2-shp-survey-js .shplugin archive.

.DESCRIPTION
    Thin wrapper around scripts/build-shplugin.mjs. The Node script
    builds the frontend runtime, hashes + signs + zips the archive,
    and self-validates the checksums.

    Required env (one of):
      $env:SELFHELP_PLUGIN_SIGNING_KEY       (production; also set
                                              $env:SELFHELP_PLUGIN_SIGNING_KEY_ID)
      $env:SELFHELP_PLUGIN_DEV_SIGNING_KEY   (local dev, keyId=dev)

.PARAMETER SkipBuild
    Skip the `npm --prefix frontend run build:runtime` step. Use only
    when you have a freshly-built `frontend/dist/plugin.esm.js` already.

.EXAMPLE
    .\scripts\build-shplugin.ps1
    .\scripts\build-shplugin.ps1 -SkipBuild
#>

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$NodeScript = Join-Path $ScriptDir "build-shplugin.mjs"

$NodeArgs = @($NodeScript)
if ($SkipBuild) { $NodeArgs += "--skip-build" }

node @NodeArgs
if ($LASTEXITCODE -ne 0) {
    throw "build-shplugin.mjs failed with exit code $LASTEXITCODE"
}

# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0

<#
.SYNOPSIS
    One-shot local installer for the sh2-shp-survey-js plugin.

.DESCRIPTION
    Single canonical install flow with two modes:

      Default (.shplugin mode)
        1. Build the plugin's .shplugin archive (scripts/build-shplugin.ps1).
        2. Upload the .shplugin to the local host via
           POST /cms-api/v1/admin/plugins/install (multipart/form-data,
           source=archive). The host dispatches the InstallPluginMessage
           on the plugin_ops Messenger transport.
        3. Drain the Messenger queue inline by running
           `php bin/console messenger:consume plugin_ops --limit=1
           --time-limit=120`.

      -Symlink fast-path (dev only)
        Skips the archive build and calls the host CLI directly:
        `php bin/console selfhelp:plugin:install <plugin.json>` with the
        absolute manifest path. The Composer path repo is wired so
        the bundle autoloads from the plugin checkout (no rebuild on
        every code edit).

    The frontend runtime is loaded from the dev URL declared in
    plugin.json#frontend.runtime.devEntrypointUrl, so the host needs no
    npm-link rebuild for normal UI edits — start the plugin's Vite
    dev server (`npm --prefix frontend run dev:runtime`) once and edit
    away.

.PARAMETER BackendPath
    Absolute path to the sh-selfhelp_backend checkout. Defaults to
    ../../sh-selfhelp_backend.

.PARAMETER ApiBase
    Base URL of the local host (e.g. http://localhost:8000). Default:
    http://localhost:8000.

.PARAMETER Token
    Admin JWT bearer token for the host. If empty, the script reads
    $env:SELFHELP_ADMIN_TOKEN.

.PARAMETER Symlink
    Skip the .shplugin build + upload. Wire a Composer path repo to the
    plugin checkout and invoke the host CLI installer directly.

.PARAMETER SkipBuild
    Skip the `npm --prefix frontend run build:runtime` step inside the
    .shplugin builder. Only use when you have already built the runtime
    bundle since your last code change.

.PARAMETER SkipConsume
    Skip the messenger:consume step. Use only if you already have a
    long-running worker draining `plugin_ops` in another shell.

.EXAMPLE
    .\install-local.ps1
    .\install-local.ps1 -Symlink
    .\install-local.ps1 -ApiBase 'http://localhost:8000' -Token (Get-Content .admin-token)
#>

[CmdletBinding()]
param(
    [string]$BackendPath = '',
    [string]$ApiBase     = 'http://localhost:8000',
    [string]$Token       = '',
    [switch]$Symlink,
    [switch]$SkipBuild,
    [switch]$SkipConsume
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PluginRoot  = Resolve-Path "$ScriptDir\.."
$PluginJson  = Join-Path $PluginRoot 'plugin.json'
if (-not (Test-Path $PluginJson)) { throw "plugin.json not found at $PluginJson" }

if (-not $BackendPath) { $BackendPath = (Resolve-Path "$PluginRoot\..\..\sh-selfhelp_backend" -ErrorAction SilentlyContinue) }
if (-not $BackendPath -or -not (Test-Path $BackendPath)) {
    throw "Backend path '$BackendPath' not found. Pass -BackendPath."
}

$Manifest = Get-Content $PluginJson -Raw | ConvertFrom-Json
$PluginId = $Manifest.id
$Version  = $Manifest.version

Step "Plugin:        $PluginId@$Version"
Step "Backend path:  $BackendPath"
Step "Mode:          $(if ($Symlink) { 'symlink (dev)' } else { '.shplugin upload' })"

if ($Symlink) {
    Step "Wiring composer path repo (humdek/$PluginId @dev)"
    Push-Location $BackendPath
    try {
        $RepoName    = "selfhelp/$PluginId"
        $BackendDir  = Resolve-Path (Join-Path $PluginRoot 'backend')
        composer config "repositories.$RepoName" path $BackendDir.Path | Out-Null
        composer require "humdek/$PluginId":"@dev" --no-interaction
        Ok "Composer path repo registered + bundle required."

        Step "Invoking host CLI installer"
        php bin/console selfhelp:plugin:install "$PluginJson"
        Ok "selfhelp:plugin:install dispatched."

        if (-not $SkipConsume) {
            Step "Draining plugin_ops Messenger queue"
            php bin/console messenger:consume plugin_ops --limit=1 --time-limit=120
            Ok "Plugin installed + finalised."
        } else {
            Warn "Skipped messenger:consume (-SkipConsume). Run it manually to finalise the install."
        }
    } finally { Pop-Location }
    Write-Host ""
    Write-Host "DONE (symlink mode). Start the frontend runtime dev server:" -ForegroundColor Green
    Write-Host "  npm --prefix $PluginRoot\frontend run dev:runtime"
    return
}

if ([string]::IsNullOrWhiteSpace($Token) -and -not [string]::IsNullOrWhiteSpace($env:SELFHELP_ADMIN_TOKEN)) {
    $Token = $env:SELFHELP_ADMIN_TOKEN
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "Admin JWT required. Pass -Token or set `$env:SELFHELP_ADMIN_TOKEN."
}

Step "Building .shplugin archive"
$BuildArgs = @((Join-Path $ScriptDir 'build-shplugin.mjs'))
if ($SkipBuild) { $BuildArgs += '--skip-build' }
node @BuildArgs
if ($LASTEXITCODE -ne 0) { throw "build-shplugin.mjs failed (exit $LASTEXITCODE)." }
$Archive = Join-Path $PluginRoot "dist\$PluginId-$Version.shplugin"
if (-not (Test-Path $Archive)) { throw "Expected archive missing: $Archive" }
Ok "Built $Archive"

Step "Uploading .shplugin to $ApiBase/cms-api/v1/admin/plugins/install"
$Form = @{
    source  = 'archive'
    archive = Get-Item $Archive
}
$Headers = @{ Authorization = "Bearer $Token" }
try {
    $Resp = Invoke-RestMethod -Method Post `
        -Uri "$ApiBase/cms-api/v1/admin/plugins/install" `
        -Headers $Headers `
        -Form $Form `
        -ErrorAction Stop
} catch {
    throw "Install upload failed: $($_.Exception.Message)"
}
$OpId = $Resp.data.id
Ok "Operation #$OpId queued."

if ($SkipConsume) {
    Warn "Skipped messenger:consume (-SkipConsume). Drain the worker manually to finalise."
} else {
    Step "Draining plugin_ops Messenger queue"
    Push-Location $BackendPath
    try {
        php bin/console messenger:consume plugin_ops --limit=1 --time-limit=120
        Ok "Plugin install operation finalised."
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "Verify: $ApiBase/admin/plugins"

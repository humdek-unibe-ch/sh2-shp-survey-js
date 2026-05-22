# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0

<#
.SYNOPSIS
    One-shot local installer for the sh2-shp-survey-js plugin.

.DESCRIPTION
    Wires the plugin into a local SelfHelp checkout in one shot:

      1. Adds a Composer 'path' repository to the host backend that
         points at the plugin's `backend/` directory and runs
         `composer require humdek/sh2-shp-survey-js`.
      2. Calls the host backend CLI installer
         (`php bin/console selfhelp:plugin:install`) with the absolute
         path to this plugin's `plugin.json`. In development mode the
         host immediately finalizes the install and enables the bundle.
      3. Runs `npm link` on the plugin's frontend/mobile packages so
         the host frontend/mobile checkouts resolve them without an
         npm registry round-trip.

    After the script completes, the host frontend / mobile dev servers
    pick up the new package via HMR — no manual restart needed.

.PARAMETER BackendPath
    Absolute path to the sh-selfhelp_backend checkout. Defaults to
    `../../sh-selfhelp_backend` relative to the script file.

.PARAMETER FrontendPath
    Absolute path to the sh-selfhelp_frontend checkout. Defaults to
    `../../sh-selfhelp_frontend` relative to the script file. Pass
    `-FrontendPath ''` to skip the frontend link step.

.PARAMETER MobilePath
    Absolute path to the sh-selfhelp_mobile checkout. Defaults to
    `../../sh-selfhelp_mobile` relative to the script file. Pass
    `-MobilePath ''` to skip the mobile link step.

.PARAMETER SkipComposer
    Skip the Composer path-repo + require step if Composer is not
    available on this machine.

.PARAMETER SkipNpmLink
    Skip the `npm link` step. Useful when the plugin's frontend/mobile
    npm packages are already linked.

.EXAMPLE
    .\install-local.ps1

    Installs the plugin with default paths (workspace siblings).

.EXAMPLE
    .\install-local.ps1 -BackendPath 'D:\projects\sh-selfhelp_backend' -FrontendPath 'D:\projects\sh-selfhelp_frontend' -MobilePath ''

    Installs into custom paths and skips the mobile linking step.
#>

[CmdletBinding()]
param(
    [string]$BackendPath  = '',
    [string]$FrontendPath = '',
    [string]$MobilePath   = '',
    [switch]$SkipComposer,
    [switch]$SkipNpmLink
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }

$pluginRoot     = Resolve-Path "$PSScriptRoot\.."
$pluginManifest = Join-Path $pluginRoot 'plugin.json'

if (-not (Test-Path $pluginManifest)) {
    throw "plugin.json not found at $pluginManifest. Run this script from the plugin checkout."
}

if (-not $BackendPath)  { $BackendPath  = Resolve-Path "$pluginRoot\..\..\sh-selfhelp_backend"  -ErrorAction SilentlyContinue }
if (-not $FrontendPath) { $FrontendPath = Resolve-Path "$pluginRoot\..\..\sh-selfhelp_frontend" -ErrorAction SilentlyContinue }
if (-not $MobilePath)   { $MobilePath   = Resolve-Path "$pluginRoot\..\..\sh-selfhelp_mobile"   -ErrorAction SilentlyContinue }

Write-Step "Plugin root:     $pluginRoot"
Write-Step "Backend path:    $BackendPath"
Write-Step "Frontend path:   $FrontendPath"
Write-Step "Mobile path:     $MobilePath"

if (-not $BackendPath -or -not (Test-Path $BackendPath)) {
    throw "Backend path '$BackendPath' not found. Pass -BackendPath to override."
}

# ---------------------------------------------------------------
# Step 1: composer path repo + require
# ---------------------------------------------------------------
if (-not $SkipComposer) {
    Write-Step "Linking backend bundle via Composer path repo"
    Push-Location $BackendPath
    try {
        $repoName = "selfhelp/sh2-shp-survey-js"
        $relativePath = Resolve-Path (Join-Path $pluginRoot 'backend')
        composer config "repositories.$repoName" path $relativePath.Path | Out-Null
        composer require humdek/sh2-shp-survey-js:@dev
        Write-Ok "Composer path repo registered and package required."
    } finally {
        Pop-Location
    }
} else {
    Write-Warn "Skipped Composer step (-SkipComposer)."
}

# ---------------------------------------------------------------
# Step 2: backend install (development mode auto-finalizes + enables)
# ---------------------------------------------------------------
Write-Step "Calling backend installer"
Push-Location $BackendPath
try {
    php bin/console selfhelp:plugin:install "$pluginManifest"
    Write-Ok "Backend install command finished."
} finally {
    Pop-Location
}

# ---------------------------------------------------------------
# Step 3: npm link for frontend (HMR-friendly local install)
# ---------------------------------------------------------------
if (-not $SkipNpmLink -and $FrontendPath) {
    Write-Step "Linking frontend npm package"
    $pluginFrontend = Join-Path $pluginRoot 'frontend'
    Push-Location $pluginFrontend
    try {
        npm install --legacy-peer-deps
        npm run build
        npm link
        Write-Ok "Plugin frontend package built + linked globally."
    } finally {
        Pop-Location
    }

    Push-Location $FrontendPath
    try {
        npm link "@humdek/sh2-shp-survey-js"
        Write-Ok "Host frontend now resolves @humdek/sh2-shp-survey-js from $pluginFrontend."
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------
# Step 4: npm link for mobile (optional)
# ---------------------------------------------------------------
if (-not $SkipNpmLink -and $MobilePath -and (Test-Path $MobilePath)) {
    Write-Step "Linking mobile npm package"
    $pluginMobile = Join-Path $pluginRoot 'mobile'
    Push-Location $pluginMobile
    try {
        npm install --legacy-peer-deps
        npm link
        Write-Ok "Plugin mobile package linked globally."
    } finally {
        Pop-Location
    }

    Push-Location $MobilePath
    try {
        npm link "@humdek/sh2-shp-survey-js-mobile"
        Write-Ok "Host mobile now resolves @humdek/sh2-shp-survey-js-mobile from $pluginMobile."
    } finally {
        Pop-Location
    }
} elseif (-not $MobilePath) {
    Write-Warn "Mobile path empty — skipped mobile link step."
} elseif (-not (Test-Path $MobilePath)) {
    Write-Warn "Mobile path '$MobilePath' not found — skipped mobile link step."
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "The plugin is installed and enabled. If your dev servers are running"
Write-Host "they will pick the changes up via HMR automatically:" -ForegroundColor Gray
Write-Host "  - Symfony: kernel reloads on next request."
Write-Host "  - Next.js: a hard refresh of the admin page is enough."
Write-Host "  - Expo:    re-press 'r' in the metro terminal if it does not auto-reload."

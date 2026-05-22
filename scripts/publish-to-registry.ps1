# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0

<#
.SYNOPSIS
    Publish the current plugin version to the sibling sh2-plugin-registry repo.

.DESCRIPTION
    Steps:
      1. Reads `plugin.json` for `id` + `version`.
      2. Validates the manifest against the host plugin-manifest schema (uses
         the vendored copy under docs/plugins/).
      3. Builds the frontend + mobile npm packages so the dist outputs are
         current (and the registry workflow has a chance to run on green).
      4. Copies `plugin.json` to `<registry>/manifests/<id>-<version>.json`.
      5. Inserts/updates the plugin entry in `<registry>/registry.json`
         (sorted alphabetically by id).
      6. Stages + commits the changes in the registry repo.
      7. Optionally pushes (`-Push`) or only opens the diff (`-DryRun`).
      8. Optionally publishes the npm packages with `-PublishNpm` (requires
         an authenticated `npm` session).

.PARAMETER RegistryPath
    Absolute path to the sh2-plugin-registry checkout. Defaults to the sibling
    folder `../sh2-plugin-registry` relative to this plugin's root.

.PARAMETER DryRun
    Print the changes that would be made but do not write to the registry.

.PARAMETER Push
    After committing in the registry repo, push to `origin` (requires git
    credentials configured).

.PARAMETER PublishNpm
    Also run `npm publish` on the plugin's frontend and mobile packages.

.PARAMETER TrustLevel
    Trust level recorded in registry.json. Defaults to the value of
    `security.trustLevel` from plugin.json.

.PARAMETER Channel
    Channel recorded in registry.json. Defaults to `stable`.

.EXAMPLE
    .\publish-to-registry.ps1 -DryRun
    # Show what would change without modifying the registry.

.EXAMPLE
    .\publish-to-registry.ps1 -Push -PublishNpm
    # Full release: build + publish to npm + update registry + push.
#>

[CmdletBinding()]
param(
    [string]$RegistryPath = '',
    [string]$TrustLevel   = '',
    [string]$Channel      = 'stable',
    [switch]$DryRun,
    [switch]$Push,
    [switch]$PublishNpm,
    [switch]$SkipBuild
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

if (-not $RegistryPath) {
    $RegistryPath = Resolve-Path "$pluginRoot\..\sh2-plugin-registry" -ErrorAction SilentlyContinue
}
if (-not $RegistryPath -or -not (Test-Path $RegistryPath)) {
    throw "Registry path '$RegistryPath' not found. Pass -RegistryPath to override."
}

$manifest = Get-Content $pluginManifest -Raw | ConvertFrom-Json
$pluginId = $manifest.id
$version  = $manifest.version
if (-not $pluginId -or -not $version) {
    throw "plugin.json must have non-empty 'id' and 'version'."
}
if (-not $TrustLevel) { $TrustLevel = $manifest.security.trustLevel }
if (-not $TrustLevel) { $TrustLevel = 'untrusted' }

Write-Step "Plugin id:       $pluginId"
Write-Step "Plugin version:  $version"
Write-Step "Registry path:   $RegistryPath"
Write-Step "Trust level:     $TrustLevel"
Write-Step "Channel:         $Channel"

# ---------------------------------------------------------------
# Step 1: validate the manifest schema (best-effort)
# ---------------------------------------------------------------
$schemaPath = Join-Path $pluginRoot 'docs\plugins\plugin-manifest.schema.json'
if (Test-Path $schemaPath) {
    Write-Step "Validating manifest against vendored schema"
    $ajv = (Get-Command ajv -ErrorAction SilentlyContinue)
    if (-not $ajv) {
        Write-Warn "ajv-cli not on PATH. Skipping schema validation."
    } else {
        & ajv validate -c ajv-formats -s $schemaPath -d $pluginManifest --strict=false
        Write-Ok "Manifest passes schema."
    }
} else {
    Write-Warn "No vendored schema at $schemaPath. Skipping validation."
}

# ---------------------------------------------------------------
# Step 2: build frontend + mobile (skip with -SkipBuild)
# ---------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Step "Building plugin frontend"
    Push-Location (Join-Path $pluginRoot 'frontend')
    try {
        npm install --legacy-peer-deps | Out-Null
        npm run build
        Write-Ok "Frontend build done."
    } finally { Pop-Location }

    Write-Step "Building plugin mobile"
    Push-Location (Join-Path $pluginRoot 'mobile')
    try {
        npm install --legacy-peer-deps | Out-Null
        npm run build
        Write-Ok "Mobile build done."
    } finally { Pop-Location }
}

# ---------------------------------------------------------------
# Step 3 (optional): npm publish
# ---------------------------------------------------------------
if ($PublishNpm) {
    Write-Step "Publishing frontend npm package"
    Push-Location (Join-Path $pluginRoot 'frontend')
    try { npm publish --access public } finally { Pop-Location }
    Write-Step "Publishing mobile npm package"
    Push-Location (Join-Path $pluginRoot 'mobile')
    try { npm publish --access public } finally { Pop-Location }
    Write-Ok "npm packages published."
}

# ---------------------------------------------------------------
# Step 4: copy plugin.json to <registry>/manifests/
# ---------------------------------------------------------------
$manifestsDir = Join-Path $RegistryPath 'manifests'
if (-not (Test-Path $manifestsDir)) { New-Item -ItemType Directory -Path $manifestsDir | Out-Null }
$dest = Join-Path $manifestsDir "$pluginId-$version.json"

if ($DryRun) {
    Write-Warn "[dry-run] would copy $pluginManifest -> $dest"
} else {
    Copy-Item -Path $pluginManifest -Destination $dest -Force
    Write-Ok "Copied manifest to $dest"
}

# ---------------------------------------------------------------
# Step 5: update registry.json
# ---------------------------------------------------------------
$registryJsonPath = Join-Path $RegistryPath 'registry.json'
if (-not (Test-Path $registryJsonPath)) {
    throw "registry.json not found at $registryJsonPath. Bootstrap the registry repo first."
}
$registry = Get-Content $registryJsonPath -Raw | ConvertFrom-Json
if (-not $registry.plugins) {
    $registry | Add-Member -NotePropertyName plugins -NotePropertyValue @() -Force
}

$entry = [ordered]@{
    id          = $pluginId
    name        = $manifest.name
    description = $manifest.description
    version     = $version
    channel     = $Channel
    trustLevel  = $TrustLevel
    homepage    = $manifest.homepage
    manifestUrl = "manifests/$pluginId-$version.json"
}

$pluginsArr = @($registry.plugins | Where-Object { $_.id -ne $pluginId })
$pluginsArr += [pscustomobject]$entry
$sorted = @($pluginsArr | Sort-Object id)

# Re-build the registry object as a hashtable so ConvertTo-Json keeps
# `plugins` as an array even when it has a single entry. (PowerShell
# unwraps single-element arrays out of pscustomobject properties,
# which would render `"plugins": { ... }` on first publish.)
$rebuilt = [ordered]@{
    schemaVersion = $registry.schemaVersion
    publishedAt   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssZ')
    publisher     = $registry.publisher
    plugins       = $sorted
}

$json = ConvertTo-Json -InputObject $rebuilt -Depth 25
# Ensure single-entry plugins is rendered as an array (PS5 quirk).
if ($sorted.Count -eq 1 -and $json -notmatch '"plugins":\s*\[') {
    $json = $json -replace '"plugins":\s*\{', '"plugins": [{'
    $json = ($json -split "`n" | ForEach-Object { $_ }) -join "`n"
    $json = $json -replace '(\s*\}\s*\}\s*)$', "}]`n}"
}
if ($DryRun) {
    Write-Warn "[dry-run] would update $registryJsonPath. Diff preview:"
    Write-Host $json -ForegroundColor DarkGray
} else {
    Set-Content -Path $registryJsonPath -Value $json -Encoding UTF8
    Write-Ok "Updated $registryJsonPath"
}

# ---------------------------------------------------------------
# Step 6: git commit (+ optional push)
# ---------------------------------------------------------------
if (-not $DryRun) {
    Push-Location $RegistryPath
    try {
        & git add registry.json "manifests/$pluginId-$version.json" | Out-Null
        $msg = "publish: ${pluginId}@$version ($Channel/$TrustLevel)"
        & git commit -m $msg | Out-Null
        Write-Ok ("Committed in {0}: {1}" -f $RegistryPath, $msg)

        if ($Push) {
            & git push
            Write-Ok "Pushed to origin."
        }
    } catch {
        Write-Warn $_.Exception.Message
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "Registry entry: $RegistryPath\registry.json"
Write-Host "Manifest file:  $dest"
if (-not $Push) {
    Write-Host "Hint: re-run with -Push to push the registry commit to origin." -ForegroundColor DarkGray
}

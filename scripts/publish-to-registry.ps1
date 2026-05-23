# SPDX-FileCopyrightText: 2026 Humdek, University of Bern
# SPDX-License-Identifier: MPL-2.0

<#
.SYNOPSIS
    Publish this plugin version to the sibling sh2-plugin-registry repo.

.DESCRIPTION
    Mirrors publish-to-registry.sh.

    Pipeline:
      1. build-shplugin.ps1 / .mjs       — builds dist/<id>-<ver>.shplugin
                                           + canonical signed payload + signature.
      2. build-registry-entry.mjs        — emits the signed pluginEntry JSON
                                           (reuses the canonical signing logic).
      3. Copies plugin.json to <registry>/manifests/<id>-<ver>.json.
      4. Copies dist/shplugin/<id>-<ver>/artifacts/* to
         <registry>/artifacts/<id>-<ver>/.
      5. Splices the registry entry into <registry>/registry.json (deduping
         by id) and re-sorts.
      6. git add + commit (push optional).
      7. -Release  → gh release create v<ver> dist/<id>-<ver>.shplugin
                                       --notes-file CHANGELOG.md

    Required env (one of):
      $env:SELFHELP_PLUGIN_SIGNING_KEY       (+ $env:SELFHELP_PLUGIN_SIGNING_KEY_ID)
      $env:SELFHELP_PLUGIN_DEV_SIGNING_KEY   (local dev, keyId=dev)

.PARAMETER RegistryPath
    Absolute path to the sh2-plugin-registry checkout. Defaults to a
    sibling at `../sh2-plugin-registry`.

.PARAMETER Channel
    Release channel (`stable`, `beta`, `alpha`, `nightly`). Default `stable`.

.PARAMETER DryRun
    Print actions without writing to the registry or committing.

.PARAMETER Push
    `git push` the registry commit after committing.

.PARAMETER Release
    Also run `gh release create v<version> <archive>` to attach the
    .shplugin as a GitHub Release asset for offline installs.

.PARAMETER SkipBuild
    Skip `npm --prefix frontend run build:runtime` (use only after a
    fresh build).

.EXAMPLE
    .\scripts\publish-to-registry.ps1 -Push -Release
#>

param(
    [string]$RegistryPath,
    [ValidateSet("stable","beta","alpha","nightly")]
    [string]$Channel = "stable",
    [switch]$DryRun,
    [switch]$Push,
    [switch]$Release,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PluginRoot = Resolve-Path "$ScriptDir\.."
$PluginJson = Join-Path $PluginRoot "plugin.json"

if (-not (Test-Path $PluginJson)) { throw "plugin.json not found at $PluginJson" }

if ([string]::IsNullOrWhiteSpace($RegistryPath)) {
    $RegistryPath = (Resolve-Path "$PluginRoot\..\sh2-plugin-registry" -ErrorAction Stop).Path
}
if (-not (Test-Path $RegistryPath)) { throw "Registry path '$RegistryPath' not found. Pass -RegistryPath." }

$Manifest = Get-Content $PluginJson -Raw | ConvertFrom-Json
$PluginId = $Manifest.id
$Version  = $Manifest.version
$Archive  = Join-Path $PluginRoot "dist\$PluginId-$Version.shplugin"
$Stage    = Join-Path $PluginRoot "dist\shplugin\$PluginId-$Version"

Step "Plugin id:       $PluginId"
Step "Plugin version:  $Version"
Step "Registry path:   $RegistryPath"
Step "Channel:         $Channel"

# 1) build .shplugin
Step "Building .shplugin archive"
$BuildArgs = @((Join-Path $ScriptDir "build-shplugin.mjs"))
if ($SkipBuild) { $BuildArgs += "--skip-build" }
node @BuildArgs
if ($LASTEXITCODE -ne 0) { throw "build-shplugin.mjs failed (exit $LASTEXITCODE)." }
if (-not (Test-Path $Archive)) { throw "Expected archive missing: $Archive" }
Ok "Built $Archive"

# 2) hashing for entry build
$EsmHash = (Get-FileHash -Algorithm SHA256 (Join-Path $Stage "artifacts\plugin.esm.js")).Hash.ToLower()
$CssPath = Join-Path $Stage "artifacts\plugin.css"
$HasCss  = Test-Path $CssPath
$CssHash = $null
if ($HasCss) { $CssHash = (Get-FileHash -Algorithm SHA256 $CssPath).Hash.ToLower() }

$EntrypointUrl = "artifacts/$PluginId-$Version/plugin.esm.js"
$StylesheetUrl = if ($HasCss) { "artifacts/$PluginId-$Version/plugin.css" } else { $null }

Step "Generating signed registry entry"
$EntryArgs = @(
    (Join-Path $RegistryPath "scripts\build-registry-entry.mjs")
    "--manifest", $PluginJson
    "--esm",      (Join-Path $Stage "artifacts\plugin.esm.js")
    "--entrypoint-url", $EntrypointUrl
    "--channel", $Channel
)
if ($HasCss) {
    $EntryArgs += @("--css", $CssPath, "--stylesheet-url", $StylesheetUrl)
}
$EntryJson = (& node @EntryArgs) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "build-registry-entry.mjs failed (exit $LASTEXITCODE)." }
Ok "Registry entry signed."

# 3) destinations
$DestManifest  = Join-Path $RegistryPath "manifests\$PluginId-$Version.json"
$DestArtifacts = Join-Path $RegistryPath "artifacts\$PluginId-$Version"
$RegistryJson  = Join-Path $RegistryPath "registry.json"

if ($DryRun) {
    Warn "[dry-run] would copy plugin.json -> $DestManifest"
    Warn "[dry-run] would copy artifacts/* -> $DestArtifacts"
    Warn "[dry-run] would splice signed entry into $RegistryJson"
    Write-Output $EntryJson
    return
}

New-Item -ItemType Directory -Force -Path (Split-Path $DestManifest) | Out-Null
New-Item -ItemType Directory -Force -Path $DestArtifacts | Out-Null
Copy-Item -Force $PluginJson $DestManifest
Copy-Item -Force (Join-Path $Stage "artifacts\plugin.esm.js") (Join-Path $DestArtifacts "plugin.esm.js")
if ($HasCss) {
    Copy-Item -Force $CssPath (Join-Path $DestArtifacts "plugin.css")
}
Ok "Copied manifest + artifacts."

# 4) splice entry into registry.json
$Registry = Get-Content $RegistryJson -Raw | ConvertFrom-Json
$Entry    = $EntryJson | ConvertFrom-Json
$ExistingIds = @($Registry.plugins | Where-Object { $_.id -ne $PluginId })
$Updated = @($ExistingIds + $Entry) | Sort-Object id
$Registry.publishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$Registry.plugins     = $Updated
($Registry | ConvertTo-Json -Depth 100) | Set-Content -NoNewline -Encoding UTF8 $RegistryJson
Ok "Updated $RegistryJson"

Push-Location $RegistryPath
try {
    git add registry.json "manifests/$PluginId-$Version.json" "artifacts/$PluginId-$Version/"
    git commit -m "publish: $PluginId@$Version ($Channel)"
    Ok "Committed in $RegistryPath."
    if ($Push) {
        git push
        Ok "Pushed registry to origin."
    }
} finally { Pop-Location }

if ($Release) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "-Release requires the gh CLI." }
    Push-Location $PluginRoot
    try {
        $NotesArgs = @()
        if (Test-Path "$PluginRoot\CHANGELOG.md") {
            $NotesArgs = @("--notes-file", "$PluginRoot\CHANGELOG.md")
        }
        Step "Creating GitHub Release v$Version"
        gh release create "v$Version" $Archive @NotesArgs
        Ok "Release published; .shplugin attached as asset."
    } finally { Pop-Location }
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "Archive:        $Archive"
Write-Host "Registry entry: $RegistryJson"
Write-Host "Manifest copy:  $DestManifest"
Write-Host "Artifacts dir:  $DestArtifacts"
if (-not $Push)    { Write-Host "Hint: re-run with -Push to push the registry commit." }
if (-not $Release) { Write-Host "Hint: re-run with -Release to also publish the .shplugin as a GH Release asset." }

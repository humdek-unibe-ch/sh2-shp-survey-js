#!/usr/bin/env node
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `build-shplugin.mjs` — packages this plugin into a `.shplugin`
 * archive that the host can install via the unified
 * `POST /admin/plugins/install` endpoint.
 *
 * Two archive modes:
 *
 *   `--mode connected`
 *     Layout: plugin.json + signature.json + artifacts/*.
 *     Backend Composer package resolved by the host from Packagist /
 *     VCS (`backend.composer.{package,version,repository?}`).
 *
 *   `--mode standalone`
 *     Layout: connected layout + backend/package/{composer.json, src,
 *     config, …}. The host installs the backend bundle via a Composer
 *     path repository pointing at the staged package — Packagist is not
 *     consulted for the plugin itself. Third-party Composer deps
 *     (symfony/*, doctrine/*, …) are still resolved normally;
 *     standalone mode does NOT bundle vendor/.
 *
 * Mode resolution order:
 *   1. `--mode <connected|standalone>` CLI flag wins when provided.
 *   2. Otherwise read `plugin.json#archive.mode`.
 *   3. Fall back to `connected` when no mode is declared anywhere.
 *
 * This plugin's `plugin.json#archive.mode` is `"standalone"`, so a bare
 * `node scripts/build-shplugin.mjs` produces a standalone archive that
 * carries the plugin's PHP bundle under `backend/package/`.
 *
 * Layout produced under `dist/shplugin/<id>-<version>/`:
 *
 *   plugin.json
 *   signature.json              {keyId, signature, signedPayload}
 *   artifacts/
 *     plugin.esm.js             Entry module the host imports at runtime.
 *     plugin.css                Plugin stylesheet (only when Vite emits one).
 *     <chunk>.js                Every additional .js chunk Vite emits —
 *                               e.g. survey-core-<hash>.js,
 *                               survey-react-ui-<hash>.js,
 *                               survey-creator-react-<hash>.js. plugin.esm.js
 *                               dynamically imports these via relative URLs,
 *                               so the host MUST serve every chunk next to
 *                               plugin.esm.js under the same public folder
 *                               (/plugin-artifacts/<id>-<version>/).
 *     *.map                     Source maps, only when `--source-maps` is passed.
 *     SHA256SUMS                "<sha256-hex>  <archive-root-relative path>"
 *                               per line, sorted. Covers EVERY file under
 *                               artifacts/ AND backend/package/.
 *   backend/                    (--mode standalone only)
 *     package/
 *       composer.json           required; name + version MUST match
 *                               plugin.json#backend.composer.package +
 *                               plugin.json#version.
 *       src/, config/, …        explicit include-list (see below).
 *   README.md                   (when present in the repo root)
 *
 * SHA256SUMS paths are archive-root-relative
 * ("artifacts/<file>" or "backend/package/<rel>") so the host's
 * PluginArchiveValidator accepts them — unprefixed paths are
 * rejected as a zip-slip / signed-payload-smuggling defence.
 *
 * Output:
 *   dist/<id>-<version>.shplugin     — deterministic ZIP archive
 *
 * Steps:
 *   1. Build the frontend runtime via `npm --prefix frontend run build:runtime`.
 *   2. (--mode standalone) Validate publisher contract: backend/
 *      composer.json#{name,version} must equal plugin.json#backend.
 *      composer.package + plugin.json#version. Stage backend/package/.
 *   3. Stage every emitted runtime file under `dist/shplugin/<id>-<version>/`
 *      — mirror `frontend/dist/` into `artifacts/` so plugin.esm.js
 *      *and* every Vite-emitted chunk land in the archive.
 *   4. Compute SHA-256s for every file under artifacts/ + backend/
 *      package/, write `artifacts/SHA256SUMS`.
 *   5. Construct the canonical signed payload via `sign.mjs build-payload`.
 *      For standalone archives include the `archive` block with the
 *      derived `backend.packageHash`.
 *   6. Sign with `sign.mjs sign` (Ed25519, key from env or --key).
 *   7. Write `signature.json`.
 *   8. Write `archive.mode` (and `archive.backend` for standalone) into
 *      the staged + final plugin.json so the host validator sees the
 *      same metadata that was signed.
 *   9. ZIP into `dist/<id>-<version>.shplugin` (sorted entries).
 *  10. Self-validate: recompute checksums and assert match.
 *  11. Print absolute path of the produced archive.
 *
 * Required env (one of):
 *   SELFHELP_PLUGIN_SIGNING_KEY      + SELFHELP_PLUGIN_SIGNING_KEY_ID  (CI)
 *   SELFHELP_PLUGIN_DEV_SIGNING_KEY                                    (local; keyId=dev)
 *
 * The script auto-loads `<plugin-root>/.env` when present (via Node 22's
 * `process.loadEnvFile`) so authors can keep the dev keypair next to
 * the plugin without exporting it in every shell. Real process-env
 * values always override `.env`. See `.env.example` for the full list.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

// CRC-32 table — module-load eager init so it lives above zipDirectory.
const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
    }
    return table;
})();

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRONTEND_DIR = path.join(PLUGIN_ROOT, 'frontend');
const DIST_DIR = path.join(PLUGIN_ROOT, 'dist');

// Load `.env` from the plugin root before anything reads
// `process.env`, so SELFHELP_PLUGIN_*_SIGNING_KEY can live in a
// gitignored `.env` next to plugin.json instead of being exported in
// every shell. Real process-env values still win — CI secrets injected
// into the workflow run override `.env` automatically.
loadDotEnv(path.join(PLUGIN_ROOT, '.env'));

const args = parseArgs(process.argv.slice(2));

try {
    await main();
} catch (err) {
    process.stderr.write(`build-shplugin: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

async function main() {
    const manifestPath = path.join(PLUGIN_ROOT, 'plugin.json');
    syncPluginVersionMetadata(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const id = manifest.id;
    const version = manifest.version;
    if (!id || !version) throw new Error('plugin.json missing id or version.');
    if (!manifest?.backend?.composer?.package || !manifest?.backend?.composer?.version) {
        throw new Error('plugin.json missing backend.composer.{package,version}.');
    }
    if (!manifest?.frontend?.runtime?.format) {
        throw new Error('plugin.json missing frontend.runtime.format.');
    }

    const mode = resolveArchiveMode(args, manifest);
    if (mode !== 'connected' && mode !== 'standalone') {
        throw new Error(`Unsupported --mode "${mode}" (expected "connected" or "standalone").`);
    }

    const stageRoot = path.join(DIST_DIR, 'shplugin', `${id}-${version}`);
    const artifactsDir = path.join(stageRoot, 'artifacts');
    const backendStageDir = path.join(stageRoot, 'backend', 'package');
    const archivePath = path.join(DIST_DIR, `${id}-${version}.shplugin`);

    log(`Plugin: ${id}@${version}`);
    log(`Mode:   ${mode}`);
    log(`Stage:  ${stageRoot}`);
    log(`Output: ${archivePath}`);

    if (!args['skip-build']) {
        // npm install can leave behind a node_modules dir without all
        // top-level deps (e.g. when a previous install failed). Check
        // for the actual vite binary instead of just the directory.
        const viteBin = process.platform === 'win32'
            ? path.join(FRONTEND_DIR, 'node_modules', '.bin', 'vite.cmd')
            : path.join(FRONTEND_DIR, 'node_modules', '.bin', 'vite');
        if (!existsSync(viteBin)) {
            log('[0/9] Installing frontend dependencies (npm install)…');
            // npm --prefix is unreliable with absolute paths on Windows
            // (resolves package.json from the parent dir). Use cwd
            // instead so the same call works on every platform.
            runStreaming('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], { cwd: FRONTEND_DIR });
        }
        log('[1/9] Building frontend runtime…');
        runStreaming('npm', ['run', 'build:runtime'], { cwd: FRONTEND_DIR });
    } else {
        log('[1/9] Skipping frontend build (--skip-build).');
    }

    const distDir = path.join(FRONTEND_DIR, 'dist');
    const esmSrc = path.join(distDir, 'plugin.esm.js');
    if (!existsSync(esmSrc)) {
        throw new Error(`Missing built entrypoint: ${esmSrc}. Run with --skip-build only after a previous build.`);
    }

    log('[2/9] Staging files…');
    if (existsSync(stageRoot)) rmSync(stageRoot, { recursive: true, force: true });
    mkdirSync(artifactsDir, { recursive: true });

    // The manifest written into the archive must reflect the chosen
    // mode (and, for standalone, the full archive.backend block). The
    // host validator recomputes the canonical payload from this same
    // archive copy, so any divergence would be caught downstream.
    const archivedManifest = buildArchivedManifest(manifest, mode);

    const includeSourceMaps = Boolean(args['source-maps']);
    const copiedRuntime = copyRuntimeArtifacts(distDir, artifactsDir, { includeSourceMaps });
    if (!copiedRuntime.includes('plugin.esm.js')) {
        throw new Error(`Vite did not emit plugin.esm.js into ${distDir}.`);
    }
    const hasCss = copiedRuntime.includes('plugin.css');
    log(
        `        Copied ${copiedRuntime.length} runtime file(s) from frontend/dist/ → artifacts/` +
            (includeSourceMaps ? ' (including source maps)' : '') + '.',
    );

    const readme = path.join(PLUGIN_ROOT, 'README.md');
    if (existsSync(readme)) cpSync(readme, path.join(stageRoot, 'README.md'));
    const license = path.join(PLUGIN_ROOT, 'LICENSE');
    if (existsSync(license)) cpSync(license, path.join(stageRoot, 'LICENSE'));

    if (mode === 'standalone') {
        log('[2a/9] Staging backend/package/…');
        stageBackendPackage(PLUGIN_ROOT, backendStageDir, version, manifest.backend.composer.package);
    }

    log('[3/9] Computing SHA-256 checksums…');
    const artifactEntries = listFilesRecursive(artifactsDir)
        .filter((rel) => rel !== 'SHA256SUMS')
        .map((rel) => ({
            archiveRel: `artifacts/${rel}`,
            absPath: path.join(artifactsDir, rel),
        }));
    const backendEntries = mode === 'standalone'
        ? listFilesRecursive(backendStageDir).map((rel) => ({
              archiveRel: `backend/package/${rel}`,
              absPath: path.join(backendStageDir, rel),
          }))
        : [];

    const sums = [...artifactEntries, ...backendEntries]
        .map((entry) => ({
            archiveRel: entry.archiveRel,
            hash: sha256Hex(readFileSync(entry.absPath)),
        }))
        .sort((a, b) => a.archiveRel.localeCompare(b.archiveRel));
    const sumsBody = sums.map((s) => `${s.hash}  ${s.archiveRel}`).join('\n') + '\n';
    writeFileSync(path.join(artifactsDir, 'SHA256SUMS'), sumsBody, 'utf8');
    log(`        ${sums.length} file(s) hashed (artifacts=${artifactEntries.length}, backend=${backendEntries.length}).`);

    log('[4/9] Building canonical signed payload…');
    const signScript = resolveSignScript();
    // The PHP host (`PluginArchiveValidator::normaliseChecksum`) reconstructs
    // the canonical payload with `sha256-` prefixed hashes (matching the
    // SRI / fixtures convention). Emit the same shape here so the
    // recomputed bytes are byte-identical to what we sign.
    const esmEntry = sums.find((s) => s.archiveRel === 'artifacts/plugin.esm.js');
    if (!esmEntry) throw new Error('Internal error: artifacts/plugin.esm.js is not in SHA256SUMS.');
    const esmHash = `sha256-${esmEntry.hash}`;
    const cssEntry = hasCss ? sums.find((s) => s.archiveRel === 'artifacts/plugin.css') : null;
    const cssHash = cssEntry ? `sha256-${cssEntry.hash}` : null;

    const payloadInput = {
        pluginId: id,
        version,
        composer: {
            package: manifest.backend.composer.package,
            version: manifest.backend.composer.version,
        },
        runtime: {
            entrypointUrl: `artifacts/plugin.esm.js`,
            format: manifest.frontend.runtime.format,
            ...(hasCss ? { stylesheetUrl: `artifacts/plugin.css` } : {}),
        },
        checksums: {
            frontendEsm: esmHash,
            ...(hasCss ? { frontendCss: cssHash } : {}),
        },
        compatibility: manifest.compatibility,
    };
    if (mode === 'standalone') {
        payloadInput.archive = {
            mode: 'standalone',
            backend: {
                included: true,
                path: 'backend/package',
                installMode: 'composer-path-repository',
                packageHash: computeBackendPackageHash(sums),
            },
        };
    }
    const canonical = execFileSync('node', [signScript, 'build-payload', '--input', '-'], {
        input: JSON.stringify(payloadInput),
        encoding: 'utf8',
    });

    log('[5/9] Signing payload (Ed25519)…');
    const signResult = execFileSync('node', [signScript, 'sign', '--payload', '-'], {
        input: canonical,
        encoding: 'utf8',
        env: process.env,
    });
    const signed = JSON.parse(signResult);
    writeFileSync(path.join(stageRoot, 'signature.json'), JSON.stringify(signed, null, 2) + '\n', 'utf8');
    log(`        keyId=${signed.keyId}, signature length=${signed.signature.length} chars.`);

    // Write the archive-copy of plugin.json AFTER the payload is built
    // so the canonical recomputation on the host side sees the same
    // bytes we signed. The on-disk source plugin.json in the repo is
    // not touched — only the staged copy carries the `archive` block.
    writeFileSync(path.join(stageRoot, 'plugin.json'), JSON.stringify(archivedManifest, null, 4) + '\n', 'utf8');

    log('[6/9] Building deterministic ZIP archive…');
    if (existsSync(archivePath)) rmSync(archivePath);
    zipDirectory(stageRoot, archivePath);

    log('[7/9] Self-validating archive…');
    selfValidate(archivePath, stageRoot);

    log('[8/9] Done.');
    log(`✔ ${archivePath}`);
}

// ---------------------------------------------------------------------
// Archive-mode helpers
// ---------------------------------------------------------------------

/**
 * Resolves the archive mode from CLI args and the manifest.
 *   1. `--mode <connected|standalone>` wins when provided.
 *   2. Otherwise, fall back to `plugin.json#archive.mode`.
 *   3. Default to `connected` when no mode is declared anywhere.
 */
function resolveArchiveMode(cliArgs, manifest) {
    if (typeof cliArgs.mode === 'string' && cliArgs.mode !== '') {
        return cliArgs.mode;
    }
    const manifestMode = manifest?.archive?.mode;
    if (typeof manifestMode === 'string' && manifestMode !== '') {
        return manifestMode;
    }
    return 'connected';
}

/**
 * Returns a copy of `plugin.json` with the `archive` block populated.
 * For connected archives we set `archive.mode = "connected"` so the
 * manifest is self-describing even when the publisher omitted the
 * block. For standalone archives we add the backend descriptor.
 *
 * The actual `packageHash` is NOT written here — it is computed from
 * the staged backend tree at SHA256SUMS time. The host validator
 * recomputes the same hash from disk, so persisting it inside the
 * manifest would be redundant (and would create a chicken-and-egg
 * problem: signing the manifest requires the hash, but the hash
 * depends on the staged tree, which depends on the manifest).
 */
function buildArchivedManifest(manifest, mode) {
    const cloned = JSON.parse(JSON.stringify(manifest));
    if (mode === 'standalone') {
        cloned.archive = {
            mode: 'standalone',
            backend: {
                included: true,
                path: 'backend/package',
                installMode: 'composer-path-repository',
            },
        };
    } else {
        cloned.archive = { mode: 'connected' };
    }
    // Remove devEntrypointUrl from archived manifest so the host uses
    // the bundled artifacts instead of trying to load from a dev server.
    if (cloned.frontend?.runtime?.devEntrypointUrl) {
        delete cloned.frontend.runtime.devEntrypointUrl;
    }
    return cloned;
}

/**
 * Copies the plugin's backend/ tree into <stage>/backend/package using
 * an explicit include-list. Hard-rejects the publisher contract
 * violations (composer name + version mismatch) before staging anything.
 *
 * Include-list:
 *   composer.json (required)
 *   src/, config/, migrations/, Resources/    (when present)
 *
 * Exclude-list (hard, even if accidentally added to include dirs):
 *   vendor/, var/, .git/, .github/, tests/, node_modules/, build caches,
 *   *.lock files, dot-files at any depth.
 */
function stageBackendPackage(pluginRoot, backendStageDir, pluginVersion, expectedComposerName) {
    const backendSrc = path.join(pluginRoot, 'backend');
    const composerJsonPath = path.join(backendSrc, 'composer.json');
    if (!existsSync(composerJsonPath)) {
        throw new Error(
            `--mode standalone requires backend/composer.json at ${composerJsonPath}. ` +
                `Add the plugin's Symfony bundle composer.json before building a standalone archive.`,
        );
    }

    let composerJson;
    try {
        composerJson = JSON.parse(readFileSync(composerJsonPath, 'utf8'));
    } catch (err) {
        throw new Error(`backend/composer.json is not valid JSON: ${err.message}`);
    }

    if (typeof composerJson.name !== 'string' || composerJson.name === '') {
        throw new Error('backend/composer.json is missing the required "name" field.');
    }
    if (composerJson.name !== expectedComposerName) {
        throw new Error(
            `Publisher contract violated: backend/composer.json#name "${composerJson.name}" ` +
                `does not match plugin.json#backend.composer.package "${expectedComposerName}". ` +
                `Keep these two values in sync.`,
        );
    }
    if (typeof composerJson.version !== 'string' || composerJson.version === '') {
        throw new Error(
            `backend/composer.json is missing the required "version" field. ` +
                `For standalone archives the publisher MUST pin the version explicitly so the host's ` +
                `composer require constraint resolves uniformly. Add "version": "${pluginVersion}".`,
        );
    }
    if (composerJson.version !== pluginVersion) {
        throw new Error(
            `Publisher contract violated: backend/composer.json#version "${composerJson.version}" ` +
                `does not match plugin.json#version "${pluginVersion}". Keep these two values in sync.`,
        );
    }

    if (composerJson.scripts && typeof composerJson.scripts === 'object' && Object.keys(composerJson.scripts).length > 0) {
        // The host validator already rejects this (defence-in-depth on
        // top of `composer require --no-scripts`). Fail fast here so the
        // publisher doesn't ship an archive the host will reject.
        log('        WARNING: backend/composer.json declares a "scripts" block — the host validator will reject this unless SELFHELP_PLUGIN_ALLOW_COMPOSER_SCRIPTS=1 is set.');
    }

    mkdirSync(backendStageDir, { recursive: true });

    // composer.json — always.
    cpSync(composerJsonPath, path.join(backendStageDir, 'composer.json'));

    // Optional directories — keep the include-list explicit so a stray
    // dir under backend/ (e.g. .idea/) is never staged by accident.
    const includeDirs = ['src', 'config', 'migrations', 'Resources'];
    for (const dirName of includeDirs) {
        const srcDir = path.join(backendSrc, dirName);
        if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
            copyTreeFiltered(srcDir, path.join(backendStageDir, dirName));
        }
    }

    // Top-level files we permit in the backend slot.
    const optionalFiles = ['LICENSE', 'README.md', 'CHANGELOG.md'];
    for (const fileName of optionalFiles) {
        const srcFile = path.join(backendSrc, fileName);
        if (existsSync(srcFile) && statSync(srcFile).isFile()) {
            cpSync(srcFile, path.join(backendStageDir, fileName));
        }
    }
}

/**
 * Mirrors `frontend/dist/` into the staged `artifacts/` directory.
 *
 * Vite's library build emits `plugin.esm.js` plus per-package chunks
 * (e.g. `survey-core-<hash>.js`, `survey-react-ui-<hash>.js`,
 * `survey-creator-react-<hash>.js`). The entry module dynamically
 * imports those chunks via relative URLs, so the host MUST serve them
 * next to plugin.esm.js at `/plugin-artifacts/<id>-<version>/`. Copying
 * the whole `frontend/dist/` tree guarantees every chunk lands in the
 * archive without us having to enumerate filenames Vite picks at build
 * time.
 *
 * `.map` source maps are skipped unless --source-maps is passed —
 * shipping them bloats the archive 5–10× and they aren't used by the
 * runtime. Use --source-maps for nightly / debug builds when source
 * maps are intentionally distributed.
 */
function copyRuntimeArtifacts(srcDir, destDir, { includeSourceMaps }) {
    if (!existsSync(srcDir)) {
        throw new Error(`Vite build output missing: ${srcDir}. Run \`npm run build:runtime\` in frontend/ first.`);
    }
    mkdirSync(destDir, { recursive: true });
    const copied = [];
    function walk(curSrc, curDest, prefix) {
        const entries = readdirSync(curSrc, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const sChild = path.join(curSrc, entry.name);
            const dChild = path.join(curDest, entry.name);
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                mkdirSync(dChild, { recursive: true });
                walk(sChild, dChild, rel);
                continue;
            }
            if (!entry.isFile()) continue;
            if (entry.name.endsWith('.map') && !includeSourceMaps) continue;
            cpSync(sChild, dChild);
            copied.push(rel);
        }
    }
    walk(srcDir, destDir, '');
    return copied;
}

/**
 * Recursive copy with an exclude-list applied to every directory and
 * file name encountered. Mirrors what `rsync --exclude` would do.
 */
function copyTreeFiltered(srcDir, destDir) {
    const EXCLUDED_NAMES = new Set([
        'vendor', 'var', '.git', '.github', '.idea', '.vscode',
        'node_modules', 'tests', 'test', '__pycache__',
        '.phpunit.cache', '.phpunit.result.cache', '.php-cs-fixer.cache',
        '.phpstan.cache', '.psalm-cache', 'phpstan.cache',
        'composer.lock',
    ]);
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            mkdirSync(destPath, { recursive: true });
            copyTreeFiltered(srcPath, destPath);
        } else if (entry.isFile()) {
            mkdirSync(path.dirname(destPath), { recursive: true });
            cpSync(srcPath, destPath);
        }
    }
}

/**
 * Derives `archive.backend.packageHash` from the SHA256SUMS entries
 * that live under `backend/package/`. The host's
 * PluginArchiveValidator::computeBackendPackageHash uses the same
 * formula, so the recomputed canonical payload stays byte-identical.
 *
 * Formula: sort entries by archive-relative path, join "<hex>  <rel>"
 * lines with "\n", sha256 the resulting string. Prefix with "sha256-".
 */
function computeBackendPackageHash(sums) {
    const lines = sums
        .filter((s) => s.archiveRel.startsWith('backend/package/'))
        .slice()
        .sort((a, b) => a.archiveRel.localeCompare(b.archiveRel))
        .map((s) => `${s.hash}  ${s.archiveRel}`);
    return 'sha256-' + sha256Hex(Buffer.from(lines.join('\n'), 'utf8'));
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function resolveSignScript() {
    const sibling = path.resolve(PLUGIN_ROOT, '..', 'sh2-plugin-registry', 'scripts', 'sign.mjs');
    if (existsSync(sibling)) return sibling;
    throw new Error(
        `Could not locate sign.mjs. Expected sibling checkout at ${sibling}. ` +
            `Clone https://github.com/humdek-unibe-ch/sh2-plugin-registry beside this plugin.`,
    );
}

function listFilesRecursive(dir, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const child = path.join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listFilesRecursive(child, rel));
        else out.push(rel);
    }
    return out;
}

function sha256Hex(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function zipDirectory(srcDir, destZip) {
    // Pure-Node ZIP writer. No external dep, no OS-specific quirks
    // (PowerShell's Compress-Archive writes Windows backslashes into
    // the ZIP entry names which the host's PluginArchiveValidator
    // rejects). Outputs a deterministic, forward-slash, DEFLATE-encoded
    // ZIP that interoperates with PHP's ZipArchive.
    const files = listFilesRecursive(srcDir).sort((a, b) => a.localeCompare(b));
    if (files.length === 0) throw new Error(`Nothing to zip under ${srcDir}.`);

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const rel of files) {
        // Normalise to forward slashes — required by the .shplugin spec
        // and by PluginArchiveValidator's SHA256SUMS prefix check.
        const entryName = rel.split(path.sep).join('/');
        const nameBytes = Buffer.from(entryName, 'utf8');
        const data = readFileSync(path.join(srcDir, rel));
        const crc32 = computeCrc32(data);
        const compressed = deflateRawSync(data, { level: 9 });
        const useDeflate = compressed.length < data.length;
        const payload = useDeflate ? compressed : data;
        const method = useDeflate ? 8 : 0; // 8 = DEFLATE, 0 = stored.

        // Local file header.
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); // signature
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 names
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);          // mtime
        local.writeUInt16LE(0x2126, 12);     // mdate (2026-01-06; deterministic)
        local.writeUInt32LE(crc32, 14);
        local.writeUInt32LE(payload.length, 18); // compressed size
        local.writeUInt32LE(data.length, 22);    // uncompressed size
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28);          // extra field length
        localParts.push(local, nameBytes, payload);

        // Central directory record.
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); // signature
        central.writeUInt16LE(0x031e, 4);     // version made by (Unix, 3.0)
        central.writeUInt16LE(20, 6);         // version needed
        central.writeUInt16LE(0x0800, 8);     // flags
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(0, 12);         // mtime
        central.writeUInt16LE(0x2126, 14);    // mdate
        central.writeUInt32LE(crc32, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(0, 30);         // extra
        central.writeUInt16LE(0, 32);         // comment
        central.writeUInt16LE(0, 34);         // disk
        central.writeUInt16LE(0, 36);         // internal attrs
        central.writeUInt32LE(0o644 << 16, 38); // external attrs (Unix 0644)
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBytes);

        offset += local.length + nameBytes.length + payload.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    if (existsSync(destZip)) rmSync(destZip);
    writeFileSync(destZip, Buffer.concat([...localParts, centralBuf, eocd]));
}

function computeCrc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function selfValidate(archivePath, stageRoot) {
    const stat = statSync(archivePath);
    if (stat.size < 32) throw new Error(`Archive too small (${stat.size} bytes).`);
    // Re-hash the staged artifacts and compare against SHA256SUMS for sanity.
    const sumsFile = path.join(stageRoot, 'artifacts', 'SHA256SUMS');
    const sumsBody = readFileSync(sumsFile, 'utf8');
    for (const line of sumsBody.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [hash, rel] = line.split(/\s{2,}/);
        if (!hash || !rel) throw new Error(`Malformed SHA256SUMS line: "${line}"`);
        // Paths in SHA256SUMS are archive-root-relative
        // ("artifacts/<file>"). Resolve from stageRoot, not from
        // stageRoot/artifacts/, otherwise this would look for
        // `<stage>/artifacts/artifacts/plugin.esm.js`.
        const actual = sha256Hex(readFileSync(path.join(stageRoot, rel)));
        if (actual !== hash) throw new Error(`Checksum mismatch for ${rel}: expected ${hash}, got ${actual}.`);
    }
}

function runStreaming(cmd, argv, opts = {}) {
    const result = spawnSync(cmd, argv, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...opts,
    });
    if (result.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed (exit ${result.status}).`);
}

function parseArgs(rest) {
    const out = { _: [] };
    for (let i = 0; i < rest.length; i++) {
        const tok = rest[i];
        if (tok.startsWith('--')) {
            const k = tok.slice(2);
            const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
            out[k] = v;
        } else {
            out._.push(tok);
        }
    }
    return out;
}

function log(msg) {
    process.stderr.write(`[build-shplugin] ${msg}\n`);
}

/**
 * Treat `plugin.json#version` as the single canonical plugin version
 * and rewrite mirrored version fields before packaging. This keeps the
 * archive contract intact while letting authors bump only one value.
 */
function syncPluginVersionMetadata(manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const version = manifest?.version;
    if (typeof version !== 'string' || version === '') {
        throw new Error('plugin.json missing version.');
    }

    const touched = [];

    if (manifest?.backend?.composer?.version !== version) {
        manifest.backend.composer.version = version;
        touched.push('plugin.json#backend.composer.version');
    }
    if (manifest?.mobile?.version !== version) {
        manifest.mobile.version = version;
        touched.push('plugin.json#mobile.version');
    }
    if (touched.length > 0) {
        writeJsonFile(manifestPath, manifest);
    }

    syncJsonVersionField(path.join(PLUGIN_ROOT, 'backend', 'composer.json'), version);
    syncJsonVersionField(path.join(PLUGIN_ROOT, 'frontend', 'package.json'), version);
    syncJsonVersionField(path.join(PLUGIN_ROOT, 'mobile', 'package.json'), version);
    syncPackageLockVersion(path.join(PLUGIN_ROOT, 'frontend', 'package-lock.json'), version);
    syncPackageLockVersion(path.join(PLUGIN_ROOT, 'mobile', 'package-lock.json'), version);
    syncSourceVersion(path.join(PLUGIN_ROOT, 'frontend', 'src', 'index.ts'), version);
    syncSourceVersion(path.join(PLUGIN_ROOT, 'mobile', 'src', 'index.ts'), version);

    if (touched.length > 0) {
        log(`Synced manifest version mirrors to ${version}.`);
    }
}

function syncJsonVersionField(filePath, version) {
    if (!existsSync(filePath)) return;
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    if (json.version === version) return;
    json.version = version;
    writeJsonFile(filePath, json);
    log(`Synced ${path.relative(PLUGIN_ROOT, filePath)} -> ${version}`);
}

function syncPackageLockVersion(filePath, version) {
    if (!existsSync(filePath)) return;
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    let changed = false;
    if (json.version !== version) {
        json.version = version;
        changed = true;
    }
    if (json.packages && json.packages[''] && json.packages[''].version !== version) {
        json.packages[''].version = version;
        changed = true;
    }
    if (!changed) return;
    writeJsonFile(filePath, json);
    log(`Synced ${path.relative(PLUGIN_ROOT, filePath)} -> ${version}`);
}

function syncSourceVersion(filePath, version) {
    if (!existsSync(filePath)) return;
    const src = readFileSync(filePath, 'utf8');
    const next = src.replace(
        /export const PLUGIN_VERSION = '([^']+)';/,
        `export const PLUGIN_VERSION = '${version}';`,
    );
    if (next === src) return;
    writeFileSync(filePath, next, 'utf8');
    log(`Synced ${path.relative(PLUGIN_ROOT, filePath)} -> ${version}`);
}

function writeJsonFile(filePath, data) {
    writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

/**
 * Best-effort `.env` loader. Uses Node 22's built-in
 * `process.loadEnvFile` when present and silently no-ops if the file
 * does not exist or Node is older than 20.12. Real process-env values
 * always win — `.env` only fills in the gaps so plugin authors don't
 * have to export `SELFHELP_PLUGIN_*_SIGNING_KEY` in every shell.
 */
function loadDotEnv(envPath) {
    if (typeof process.loadEnvFile !== 'function') return;
    try {
        process.loadEnvFile(envPath);
    } catch (err) {
        if (err && err.code && err.code !== 'ENOENT') {
            process.stderr.write(`[build-shplugin] could not read ${envPath}: ${err.code}\n`);
        }
    }
}

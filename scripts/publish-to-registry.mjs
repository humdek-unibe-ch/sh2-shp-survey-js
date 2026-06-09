#!/usr/bin/env node
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `publish-to-registry.mjs` — single cross-platform registry publisher.
 *
 * Replaces the previous `publish-to-registry.{ps1,sh}` pair so PowerShell,
 * Git Bash, WSL, macOS and Linux all run the same code path.
 *
 * Pipeline (unified registry contract — multi-version plugin release refs):
 *   1. node scripts/build-shplugin.mjs   → dist/<id>-<ver>.shplugin (signed)
 *   2. <registry>/scripts/build-plugin-release.mjs → unsigned plugin-release doc
 *      (maps the manifest axes onto compatibility.core/pluginApi, pins the
 *      archive sha256), then <registry>/scripts/sign-release.mjs Ed25519-signs it
 *      → <registry>/releases/plugins/<id>-<ver>.json.
 *   3. Copy plugin.json to <registry>/manifests/<id>-<ver>.json.
 *   4. Copy dist/<id>-<ver>.shplugin to <registry>/artifacts/<id>-<ver>.shplugin
 *      (the install artifact the backend downloads + extracts; it self-hosts the
 *      runtime, so the loose ESM bundle is no longer published to the registry).
 *   5. Add the release REF to <registry>/registry.json plugins[] (multi-version:
 *      keep other versions; replace same id+version; refresh `publishedAt`).
 *   6. git add + commit. Optional `--push`.
 *   7. Optional `--release` → `gh release create v<ver> <archive>
 *      --notes-file CHANGELOG.md`.
 *
 * Required env (one of):
 *   SELFHELP_PLUGIN_SIGNING_KEY        + SELFHELP_PLUGIN_SIGNING_KEY_ID
 *   SELFHELP_PLUGIN_DEV_SIGNING_KEY    (local dev — keyId=dev; rejected
 *                                       on `official`/`reviewed` plugins
 *                                       outside APP_ENV=dev).
 *
 * Auto-loads `<plugin-root>/.env` (Node 22 `process.loadEnvFile`)
 * before reading any *_SIGNING_KEY value.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');

loadDotEnv(path.join(PLUGIN_ROOT, '.env'));

try {
    await main(parseArgs(process.argv.slice(2)));
} catch (err) {
    process.stderr.write(`publish-to-registry: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

async function main(opts) {
    if (opts.help) {
        printUsage();
        return;
    }

    const mode = opts.mode || null;
    if (mode !== null && mode !== 'connected' && mode !== 'standalone') {
        throw new Error(`--mode must be "connected" or "standalone" (got ${mode}).`);
    }

    const channel = opts.channel || 'stable';
    const allowedChannels = new Set(['stable', 'beta', 'nightly', 'test']);
    if (!allowedChannels.has(channel)) {
        throw new Error(`--channel must be one of: ${[...allowedChannels].join(', ')} (got ${channel}).`);
    }

    const manifestPath = path.join(PLUGIN_ROOT, 'plugin.json');
    if (!existsSync(manifestPath)) throw new Error(`plugin.json not found at ${manifestPath}`);
    const manifest = parseJsonFile(manifestPath);
    const pluginId = manifest.id;
    const version = manifest.version;
    if (!pluginId || !version) throw new Error('plugin.json missing id or version.');

    const registryPath = resolveRegistryPath(opts.registry);
    const archive = path.join(PLUGIN_ROOT, 'dist', `${pluginId}-${version}.shplugin`);

    step(`Plugin id:       ${pluginId}`);
    step(`Plugin version:  ${version}`);
    step(`Registry path:   ${registryPath}`);
    step(`Channel:         ${channel}`);
    if (mode !== null) {
        step(`Archive mode:    ${mode}`);
    }

    step('Building .shplugin archive');
    const buildArgs = [path.join(SCRIPT_DIR, 'build-shplugin.mjs')];
    if (opts['skip-build']) buildArgs.push('--skip-build');
    if (mode !== null) buildArgs.push('--mode', mode);
    runStreaming('node', buildArgs);
    if (!existsSync(archive)) throw new Error(`Expected archive missing: ${archive}`);
    ok(`Built ${archive}`);

    // Resolve the absolute base URL the registry is published under so the
    // signed release document references absolute artifact + manifest URLs (the
    // backend fetches manifestUrl for the Available list and downloads
    // archiveUrl + checksum-verifies it at install).
    const registryBaseUrl = resolveRegistryBaseUrl({
        cliValue: opts['registry-base-url'],
        envValue: process.env.SELFHELP_REGISTRY_BASE_URL,
        registryPath,
    });
    step(`Registry baseUrl: ${registryBaseUrl}`);

    // Unified registry contract: the registry publishes a release REF in
    // registry.json (multi-version: one per published version) pointing at a
    // signed plugin-release document. The .shplugin is the install artifact the
    // backend downloads + extracts (it self-hosts the runtime), so the registry
    // hosts the archive + manifest, not the loose ESM bundle.
    const archiveSha256 = sha256OfFile(archive);
    const relReleaseUrl = path.posix.join('releases', 'plugins', `${pluginId}-${version}.json`);
    const relManifestUrl = path.posix.join('manifests', `${pluginId}-${version}.json`);
    const relArchiveUrl = path.posix.join('artifacts', `${pluginId}-${version}.shplugin`);
    const archiveUrl = joinAbsoluteUrl(registryBaseUrl, relArchiveUrl);
    const manifestUrl = joinAbsoluteUrl(registryBaseUrl, relManifestUrl);

    const destManifest = path.join(registryPath, relManifestUrl);
    const destArchive = path.join(registryPath, relArchiveUrl);
    const destRelease = path.join(registryPath, relReleaseUrl);
    const registryJson = path.join(registryPath, 'registry.json');

    if (opts['dry-run']) {
        warn(`[dry-run] would build + sign ${relReleaseUrl} (sha256:${archiveSha256})`);
        warn(`[dry-run] would copy plugin.json -> ${destManifest}`);
        warn(`[dry-run] would copy ${path.basename(archive)} -> ${destArchive}`);
        warn(`[dry-run] would add the release ref to ${registryJson}`);
        return;
    }

    step('Assembling + signing the plugin release document');
    const buildReleaseScript = path.join(registryPath, 'scripts', 'build-plugin-release.mjs');
    const signReleaseScript = path.join(registryPath, 'scripts', 'sign-release.mjs');
    for (const helper of [buildReleaseScript, signReleaseScript]) {
        if (!existsSync(helper)) {
            throw new Error(`Expected registry helper missing: ${helper}. Update the sh2-plugin-registry checkout.`);
        }
    }
    mkdirSync(path.dirname(destRelease), { recursive: true });
    // 1. assemble the UNSIGNED release doc (manifest -> release axes, schema-checked).
    runStreaming('node', [
        buildReleaseScript,
        '--manifest', manifestPath,
        '--archive-sha256', archiveSha256,
        '--channel', channel,
        '--base-url', registryBaseUrl,
        '--archive-url', archiveUrl,
        '--manifest-url', manifestUrl,
        '--out', destRelease,
    ]);
    // 2. sign it in place (SELFHELP_PLUGIN_SIGNING_KEY/_ID from env, else dev key).
    runStreaming('node', [signReleaseScript, '--input', destRelease]);
    ok(`Signed ${relReleaseUrl}`);

    mkdirSync(path.dirname(destManifest), { recursive: true });
    mkdirSync(path.dirname(destArchive), { recursive: true });
    copyFileSync(manifestPath, destManifest);
    copyFileSync(archive, destArchive);
    ok('Copied manifest + .shplugin archive into the registry.');

    addPluginRef(registryJson, { id: pluginId, version, channel, releaseUrl: relReleaseUrl });
    ok(`Updated ${registryJson}`);

    runStreaming('git', [
        'add',
        'registry.json',
        relReleaseUrl,
        relManifestUrl,
        relArchiveUrl,
    ], { cwd: registryPath });
    runStreaming('git', ['commit', '-m', `publish: ${pluginId}@${version} (${channel})`], {
        cwd: registryPath,
    });
    ok(`Committed in ${registryPath}.`);

    if (opts.push) {
        runStreaming('git', ['push'], { cwd: registryPath });
        ok('Pushed registry to origin.');
    }

    if (opts.release) {
        if (!hasBinary('gh')) throw new Error('--release requires the gh CLI on PATH.');
        const notesArgs = [];
        const changelog = path.join(PLUGIN_ROOT, 'CHANGELOG.md');
        if (existsSync(changelog)) notesArgs.push('--notes-file', changelog);
        step(`Creating GitHub Release v${version}`);
        runStreaming('gh', ['release', 'create', `v${version}`, archive, ...notesArgs], { cwd: PLUGIN_ROOT });
        ok('Release published; .shplugin attached as asset.');
    }

    process.stdout.write(`\nDONE.\n`);
    process.stdout.write(`Archive:        ${archive}\n`);
    process.stdout.write(`Release doc:    ${destRelease}\n`);
    process.stdout.write(`Registry index: ${registryJson}\n`);
    process.stdout.write(`Manifest copy:  ${destManifest}\n`);
    process.stdout.write(`Archive copy:   ${destArchive}\n`);
    if (!opts.push) process.stdout.write('Hint: re-run with --push to push the registry commit.\n');
    if (!opts.release) process.stdout.write('Hint: re-run with --release to also publish the .shplugin as a GH Release asset.\n');
}

function addPluginRef(registryJsonPath, ref) {
    if (!existsSync(registryJsonPath)) {
        throw new Error(`registry.json not found at ${registryJsonPath}`);
    }
    const registry = parseJsonFile(registryJsonPath);
    const plugins = Array.isArray(registry.plugins) ? registry.plugins : [];
    // Multi-version registry: keep every OTHER version of this plugin (and every
    // other plugin); replace only the same id + version. Sorted by id then
    // version so the file stays deterministic.
    const others = plugins.filter((p) => !(p.id === ref.id && p.version === ref.version));
    const next = { id: ref.id, version: ref.version, channel: ref.channel, releaseUrl: ref.releaseUrl };
    const updated = [...others, next].sort((a, b) =>
        a.id === b.id
            ? String(a.version).localeCompare(String(b.version))
            : String(a.id).localeCompare(String(b.id)),
    );
    registry.publishedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    registry.plugins = updated;
    writeFileSync(registryJsonPath, JSON.stringify(registry, null, 4) + '\n', 'utf8');
}

function resolveRegistryPath(explicit) {
    const candidate = explicit
        || process.env.SELFHELP_REGISTRY_PATH
        || path.resolve(PLUGIN_ROOT, '..', 'sh2-plugin-registry');
    if (!existsSync(candidate)) {
        throw new Error(
            `Registry path '${candidate}' not found. Pass --registry <abs-path> or set ` +
                `SELFHELP_REGISTRY_PATH; clone https://github.com/humdek-unibe-ch/sh2-plugin-registry as a sibling.`,
        );
    }
    return candidate;
}

/**
 * Decide the absolute base URL that the registry is published under.
 *
 * Resolution order (highest priority first):
 *   1. `--registry-base-url <https://.../>` CLI flag.
 *   2. `SELFHELP_REGISTRY_BASE_URL` environment variable.
 *   3. `baseUrl` field declared at the top of `<registryPath>/registry.json`.
 *
 * Throws when none of those is set, because relative `entrypointUrl`
 * values break the host frontend's `await import(<url>)` and silently
 * publishing them again would just reproduce the bug.
 */
function resolveRegistryBaseUrl({ cliValue, envValue, registryPath }) {
    const candidate = typeof cliValue === 'string' && cliValue !== ''
        ? cliValue
        : typeof envValue === 'string' && envValue !== ''
            ? envValue
            : readRegistryBaseUrlFromFile(registryPath);
    if (typeof candidate !== 'string' || candidate === '') {
        throw new Error(
            'Could not determine the registry base URL. Set the `baseUrl` field at the top of '
            + `${path.join(registryPath, 'registry.json')}, or pass --registry-base-url <https://.../>, `
            + 'or export SELFHELP_REGISTRY_BASE_URL=<https://.../>.',
        );
    }
    if (!/^https?:\/\//i.test(candidate)) {
        throw new Error(`Registry baseUrl must be an absolute http(s) URL, got "${candidate}".`);
    }
    return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

function readRegistryBaseUrlFromFile(registryPath) {
    const registryJsonPath = path.join(registryPath, 'registry.json');
    if (!existsSync(registryJsonPath)) return null;
    try {
        const parsed = parseJsonFile(registryJsonPath);
        return typeof parsed.baseUrl === 'string' && parsed.baseUrl !== '' ? parsed.baseUrl : null;
    } catch {
        return null;
    }
}

function joinAbsoluteUrl(baseUrl, relativePath) {
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const trimmedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    return `${trimmedBase}${trimmedPath}`;
}

function sha256OfFile(filePath) {
    const buf = readFileSync(filePath);
    return createHash('sha256').update(buf).digest('hex');
}

function parseJsonFile(filePath) {
    return JSON.parse(stripUtf8Bom(readFileSync(filePath, 'utf8')));
}

function stripUtf8Bom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function hasBinary(name) {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(which, [name], { stdio: 'ignore', shell: process.platform === 'win32' });
    return result.status === 0;
}

function runStreaming(cmd, argv, opts = {}) {
    const result = spawnSync(cmd, argv, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...opts,
    });
    if (result.status !== 0) {
        throw new Error(`${cmd} ${argv.join(' ')} failed (exit ${result.status}).`);
    }
}

function parseArgs(rest) {
    const out = { _: [] };
    for (let i = 0; i < rest.length; i++) {
        const tok = rest[i];
        if (tok === '-h' || tok === '--help') {
            out.help = true;
            continue;
        }
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

function step(msg) { process.stdout.write(`\x1b[36m==> ${msg}\x1b[0m\n`); }
function ok(msg)   { process.stdout.write(`    \x1b[32mOK\x1b[0m  ${msg}\n`); }
function warn(msg) { process.stdout.write(`    \x1b[33m!!\x1b[0m  ${msg}\n`); }

function printUsage() {
    process.stdout.write(`Usage: node scripts/publish-to-registry.mjs [options]

Builds + signs the .shplugin, copies the manifest + runtime artifacts
into the sibling sh2-plugin-registry checkout, splices the signed
entry into <registry>/registry.json, and (optionally) pushes the
registry commit and creates a GitHub Release.

Options:
  --registry <path>   Path to the sh2-plugin-registry checkout
                      (default: ../sh2-plugin-registry; or
                      SELFHELP_REGISTRY_PATH env).
  --registry-base-url <https://.../>
                      Override the absolute base URL the registry is
                      served under. By default the publisher reads
                      "baseUrl" from <registry>/registry.json, or falls
                      back to SELFHELP_REGISTRY_BASE_URL.
  --channel <name>    stable (default), beta, nightly, or test.
  --skip-build        Skip the frontend rebuild inside build-shplugin.mjs.
  --dry-run           Print the planned changes without writing/committing.
  --push              git push the registry commit to origin.
  --release           gh release create v<version> dist/<id>-<ver>.shplugin
                      with --notes-file CHANGELOG.md when present.
  -h, --help          Show this help.

Required env (one of):
  SELFHELP_PLUGIN_SIGNING_KEY        + SELFHELP_PLUGIN_SIGNING_KEY_ID
  SELFHELP_PLUGIN_DEV_SIGNING_KEY    (local dev; keyId=dev)

Both values can live in <plugin>/.env (auto-loaded). See .env.example.
`);
}

function loadDotEnv(envPath) {
    if (typeof process.loadEnvFile !== 'function') return;
    try {
        process.loadEnvFile(envPath);
    } catch (err) {
        if (err && err.code && err.code !== 'ENOENT') {
            process.stderr.write(`publish-to-registry: could not read ${envPath}: ${err.code}\n`);
        }
    }
}

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
 * Pipeline:
 *   1. node scripts/build-shplugin.mjs   → dist/<id>-<ver>.shplugin (signed)
 *   2. <registry>/scripts/build-registry-entry.mjs  → signed pluginEntry JSON
 *      (reuses the canonical signing logic so the archive + registry entry
 *      are signed exactly once with the same key + canonical payload).
 *   3. Copy plugin.json to <registry>/manifests/<id>-<ver>.json.
 *   4. Copy dist/shplugin/<id>-<ver>/artifacts/* to
 *      <registry>/artifacts/<id>-<ver>/.
 *   5. Splice the entry into <registry>/registry.json (replace by id,
 *      sort by id, refresh `publishedAt`).
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
    const allowedChannels = new Set(['stable', 'beta', 'alpha', 'nightly']);
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
    const stage = path.join(PLUGIN_ROOT, 'dist', 'shplugin', `${pluginId}-${version}`);

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

    const stageArtifacts = path.join(stage, 'artifacts');
    const esmFile = path.join(stageArtifacts, 'plugin.esm.js');
    const cssFile = path.join(stageArtifacts, 'plugin.css');
    const hasCss = existsSync(cssFile);

    const entrypointUrl = `artifacts/${pluginId}-${version}/plugin.esm.js`;
    const stylesheetUrl = hasCss ? `artifacts/${pluginId}-${version}/plugin.css` : null;

    step('Generating signed registry entry');
    const entryScript = path.join(registryPath, 'scripts', 'build-registry-entry.mjs');
    if (!existsSync(entryScript)) {
        throw new Error(`Expected registry helper missing: ${entryScript}. Update the sh2-plugin-registry checkout.`);
    }
    const entryArgs = [
        entryScript,
        '--manifest', manifestPath,
        '--esm', esmFile,
        '--entrypoint-url', entrypointUrl,
        '--channel', channel,
    ];
    if (hasCss) entryArgs.push('--css', cssFile, '--stylesheet-url', stylesheetUrl);
    const entryJson = captureNode(entryArgs);
    let entry;
    try {
        entry = JSON.parse(entryJson);
    } catch (err) {
        throw new Error(`build-registry-entry.mjs did not emit valid JSON: ${err.message}\n${entryJson}`);
    }
    ok('Registry entry signed.');

    const destManifest = path.join(registryPath, 'manifests', `${pluginId}-${version}.json`);
    const destArtifacts = path.join(registryPath, 'artifacts', `${pluginId}-${version}`);
    const registryJson = path.join(registryPath, 'registry.json');

    if (opts['dry-run']) {
        warn(`[dry-run] would copy plugin.json -> ${destManifest}`);
        warn(`[dry-run] would copy artifacts/* -> ${destArtifacts}`);
        warn(`[dry-run] would splice signed entry into ${registryJson}`);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return;
    }

    mkdirSync(path.dirname(destManifest), { recursive: true });
    mkdirSync(destArtifacts, { recursive: true });
    copyFileSync(manifestPath, destManifest);
    copyFileSync(esmFile, path.join(destArtifacts, 'plugin.esm.js'));
    if (hasCss) copyFileSync(cssFile, path.join(destArtifacts, 'plugin.css'));
    ok('Copied manifest + artifacts.');

    spliceRegistryJson(registryJson, entry, pluginId);
    ok(`Updated ${registryJson}`);

    runStreaming('git', [
        'add',
        'registry.json',
        path.posix.join('manifests', `${pluginId}-${version}.json`),
        path.posix.join('artifacts', `${pluginId}-${version}`) + '/',
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
    process.stdout.write(`Registry entry: ${registryJson}\n`);
    process.stdout.write(`Manifest copy:  ${destManifest}\n`);
    process.stdout.write(`Artifacts dir:  ${destArtifacts}\n`);
    if (!opts.push) process.stdout.write('Hint: re-run with --push to push the registry commit.\n');
    if (!opts.release) process.stdout.write('Hint: re-run with --release to also publish the .shplugin as a GH Release asset.\n');
}

function spliceRegistryJson(registryJsonPath, entry, pluginId) {
    if (!existsSync(registryJsonPath)) {
        throw new Error(`registry.json not found at ${registryJsonPath}`);
    }
    const registry = parseJsonFile(registryJsonPath);
    const others = (registry.plugins || []).filter((p) => p.id !== pluginId);
    const updated = [...others, entry].sort((a, b) => String(a.id).localeCompare(String(b.id)));
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

function captureNode(argv) {
    const result = spawnSync('node', argv, {
        encoding: 'utf8',
        env: process.env,
        shell: false,
    });
    if (result.status !== 0) {
        throw new Error(`node ${argv.join(' ')} failed (exit ${result.status}). Stderr:\n${result.stderr}`);
    }
    return result.stdout;
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
  --channel <name>    stable (default), beta, alpha, or nightly.
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

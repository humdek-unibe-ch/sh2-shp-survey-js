#!/usr/bin/env node
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `install-local.mjs` — single cross-platform local installer.
 *
 * Replaces the previous `install-local.{ps1,sh}` pair so PowerShell,
 * Git Bash, WSL, macOS and Linux all run the same code path.
 *
 * Two modes:
 *
 *   Default (.shplugin upload — recommended)
 *     1. node scripts/build-shplugin.mjs         → dist/<id>-<ver>.shplugin
 *     2. POST .shplugin to the local host's
 *        /cms-api/v1/admin/plugins/install endpoint (multipart;
 *        source=archive). The host queues an InstallPluginMessage on
 *        the `plugin_ops` Messenger transport.
 *     3. php bin/console messenger:consume plugin_ops --limit=1
 *        --time-limit=120 drains the worker inline so the install is
 *        finalised before the script exits.
 *
 *   --symlink (dev fast-path)
 *     1. write a temporary plugin.json with backend.composer.repository
 *        pointing at <plugin>
 *     2. php bin/console selfhelp:plugin:install|update <temp plugin.json>
 *     3. messenger:consume (unless --skip-consume)
 *
 * The dev fast-path intentionally does NOT touch the host root
 * composer.json/composer.lock. The host worker installs the plugin into
 * var/plugin-composer/, the isolated plugin Composer root.
 *
 * Required env (default flow): SELFHELP_ADMIN_TOKEN (or --token).
 *
 * Auto-loads `<plugin-root>/.env` (Node 22 `process.loadEnvFile`)
 * before reading any *_SIGNING_KEY / *_ADMIN_TOKEN value.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');

loadDotEnv(path.join(PLUGIN_ROOT, '.env'));

try {
    await main(parseArgs(process.argv.slice(2)));
} catch (err) {
    process.stderr.write(`install-local: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

async function main(opts) {
    if (opts.help) {
        printUsage();
        return;
    }

    const manifestPath = path.join(PLUGIN_ROOT, 'plugin.json');
    if (!existsSync(manifestPath)) throw new Error(`plugin.json not found at ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const pluginId = manifest.id;
    const version = manifest.version;
    if (!pluginId || !version) throw new Error('plugin.json missing id or version.');

    const backendPath = resolveBackendPath(opts.backend);
    const apiBase = opts['api-base'] || process.env.SELFHELP_API_BASE || 'http://localhost:8000';

    step(`Plugin:        ${pluginId}@${version}`);
    step(`Backend path:  ${backendPath}`);
    step(`Mode:          ${opts.symlink ? 'symlink (dev)' : '.shplugin upload'}`);

    if (opts.symlink) {
        await runSymlinkMode({ pluginId, version, manifestPath, backendPath, opts });
        return;
    }

    const token = opts.token || process.env.SELFHELP_ADMIN_TOKEN || '';
    if (!token) {
        throw new Error(
            'Admin JWT required. Pass --token <jwt> or set SELFHELP_ADMIN_TOKEN ' +
                '(can live in <plugin>/.env — see .env.example).',
        );
    }

    step('Building .shplugin archive');
    const buildArgs = [path.join(SCRIPT_DIR, 'build-shplugin.mjs')];
    if (opts['skip-build']) buildArgs.push('--skip-build');
    runStreaming('node', buildArgs);
    const archive = path.join(PLUGIN_ROOT, 'dist', `${pluginId}-${version}.shplugin`);
    if (!existsSync(archive)) throw new Error(`Expected archive missing: ${archive}`);
    ok(`Built ${archive}`);

    const installUrl = `${apiBase.replace(/\/+$/, '')}/cms-api/v1/admin/plugins/install`;
    step(`Uploading .shplugin to ${installUrl}`);
    const opId = await postArchive(installUrl, token, archive);
    ok(`Operation #${opId} queued.`);

    if (opts['skip-consume']) {
        warn('Skipped messenger:consume (--skip-consume). Drain the worker manually to finalise.');
    } else {
        step('Draining plugin_ops Messenger queue');
        runStreaming('php', ['bin/console', 'messenger:consume', 'plugin_ops', '--limit=1', '--time-limit=120'], {
            cwd: backendPath,
        });
        ok('Plugin install operation finalised.');
    }

    process.stdout.write(`\nDONE.\nVerify: ${apiBase}/admin/plugins\n`);
}

async function runSymlinkMode({ pluginId, version, manifestPath, backendPath, opts }) {
    const backendDir = path.join(PLUGIN_ROOT, 'backend');
    if (!existsSync(backendDir)) throw new Error(`Plugin backend dir not found: ${backendDir}`);
    const targetVersion = normaliseVersion(version);

    step('Preparing isolated plugin Composer path repository');
    const installManifestPath = prepareSymlinkManifest(manifestPath, PLUGIN_ROOT);
    ok('Temporary development manifest prepared. Host root Composer files are untouched.');

    const installedVersion = normaliseVersion(getInstalledVersion(pluginId, backendPath));
    step(`Host plugin state: installed=${installedVersion ?? 'none'} target=${targetVersion}`);

    if (installedVersion === targetVersion) {
        step(`Plugin already installed at ${targetVersion}; reattaching local checkout`);
        runStreaming('php', ['bin/console', 'selfhelp:plugin:uninstall', pluginId], { cwd: backendPath });
        ok('selfhelp:plugin:uninstall dispatched.');

        if (opts['skip-consume']) {
            throw new Error(
                '--skip-consume cannot be used when --symlink needs to relink an already-installed plugin. ' +
                    'The uninstall must finish before the local install can be dispatched.',
            );
        }

        drainPluginOpsQueue(backendPath, 'Plugin uninstalled from the current host state.');

        step('Invoking host CLI installer for local reattach');
        runStreaming('php', ['bin/console', 'selfhelp:plugin:install', installManifestPath], { cwd: backendPath });
        ok('selfhelp:plugin:install dispatched.');

        drainPluginOpsQueue(backendPath, 'Plugin reinstalled from the local checkout.');
    } else {
        const installed = installedVersion !== null;
        step(installed ? 'Invoking host CLI updater' : 'Invoking host CLI installer');
        runStreaming('php', ['bin/console', installed ? 'selfhelp:plugin:update' : 'selfhelp:plugin:install', installManifestPath], { cwd: backendPath });
        ok(installed ? 'selfhelp:plugin:update dispatched.' : 'selfhelp:plugin:install dispatched.');

        if (opts['skip-consume']) {
            warn('Skipped messenger:consume (--skip-consume). Run it manually to finalise the install.');
        } else {
            drainPluginOpsQueue(backendPath, 'Plugin installed + finalised.');
        }
    }

    step('Enabling plugin');
    runStreaming('php', ['bin/console', 'selfhelp:plugin:enable', pluginId], { cwd: backendPath });
    ok('Plugin enabled.');

    process.stdout.write(
        `\nDONE (symlink mode).\nStart the frontend runtime dev server:\n  npm --prefix ${path.join(PLUGIN_ROOT, 'frontend')} run dev:runtime\n\nKeep the host frontend open at /admin/plugins-host/${pluginId}/surveys; plugin UI changes reload from the local runtime URL.\n`,
    );
}

function resolveBackendPath(explicit) {
    const candidate = explicit || process.env.SELFHELP_BACKEND_PATH || path.resolve(PLUGIN_ROOT, '..', '..', 'sh-selfhelp_backend');
    if (!existsSync(candidate)) {
        throw new Error(
            `Backend path '${candidate}' not found. Pass --backend <abs-path> or set SELFHELP_BACKEND_PATH.`,
        );
    }
    return candidate;
}

async function postArchive(url, token, archivePath) {
    // Prefer Node 22's native FormData + fetch — works on every OS,
    // no curl/jq dependency, no PowerShell quirks. Falls back to curl
    // if FormData is unavailable for some reason.
    if (typeof globalThis.FormData === 'function' && typeof globalThis.fetch === 'function') {
        const buf = readFileSync(archivePath);
        const filename = path.basename(archivePath);
        const blob = new Blob([buf], { type: 'application/zip' });
        const fd = new FormData();
        fd.set('source', 'archive');
        fd.set('archive', blob, filename);
        const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
        });
        const body = await res.text();
        if (!res.ok) {
            throw new Error(`Install upload failed: HTTP ${res.status} ${res.statusText}\n${body}`);
        }
        try {
            return JSON.parse(body)?.data?.id ?? '?';
        } catch {
            return '?';
        }
    }

    // Fallback: curl. Useful on hosts without Node 22's fetch.
    if (!hasBinary('curl')) {
        throw new Error('Need Node 22+ (built-in fetch) or curl on PATH to upload the archive.');
    }
    const out = execFileSync(
        'curl',
        [
            '--fail-with-body',
            '--silent',
            '--show-error',
            '-H',
            `Authorization: Bearer ${token}`,
            '-F',
            'source=archive',
            '-F',
            `archive=@${archivePath}`,
            url,
        ],
        { encoding: 'utf8' },
    );
    try {
        return JSON.parse(out)?.data?.id ?? '?';
    } catch {
        return '?';
    }
}

function hasBinary(name) {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(which, [name], { stdio: 'ignore', shell: process.platform === 'win32' });
    return result.status === 0;
}

function prepareSymlinkManifest(manifestPath, packageRoot) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.backend = manifest.backend || {};
    manifest.backend.composer = manifest.backend.composer || {};
    manifest.backend.composer.repository = {
        type: 'path',
        url: packageRoot,
    };

    const dir = mkdtempSync(path.join(tmpdir(), 'selfhelp-surveyjs-install-'));
    const out = path.join(dir, 'plugin.json');
    writeFileSync(out, JSON.stringify(manifest, null, 4) + '\n', 'utf8');
    return out;
}

function getInstalledVersion(pluginId, backendPath) {
    const result = spawnSync('php', ['bin/console', 'selfhelp:plugin:status', pluginId, '--no-ansi'], {
        cwd: backendPath,
        encoding: 'utf8',
        shell: false,
    });
    if (result.status !== 0) {
        return null;
    }
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '');
    const match = String(output).match(/Version\s+([^\s]+)/);
    return match ? match[1] : null;
}

function normaliseVersion(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim().replace(/^\uFEFF/, '');
    return trimmed === '' ? null : trimmed;
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

function drainPluginOpsQueue(backendPath, successMessage) {
    step('Draining plugin_ops Messenger queue');
    runStreaming('php', ['bin/console', 'messenger:consume', 'plugin_ops', '--limit=1', '--time-limit=120'], {
        cwd: backendPath,
    });
    ok(successMessage);
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
    process.stdout.write(`Usage: node scripts/install-local.mjs [options]

Default mode (.shplugin upload):
  Builds the .shplugin, uploads it to the local host's
  /cms-api/v1/admin/plugins/install endpoint, drains the
  plugin_ops Messenger queue inline.

  --token <jwt>        Admin JWT bearer token (or SELFHELP_ADMIN_TOKEN
                       env / .env entry).
  --api-base <url>     Host base URL (default http://localhost:8000 or
                       SELFHELP_API_BASE).
  --skip-build         Skip the frontend build inside build-shplugin.mjs.
  --skip-consume       Skip messenger:consume after the upload.

Symlink mode (dev fast-path):
  --symlink            Skip the .shplugin build + upload. Pass a temporary
                       path-repo manifest to the CLI installer/updater.
                       Host root Composer files are not modified. If the
                       same version is already installed, the script
                       reattaches the local checkout via uninstall+install.

Common options:
  --backend <path>     Path to the sh-selfhelp_backend checkout
                       (default: ../../sh-selfhelp_backend; or
                       SELFHELP_BACKEND_PATH env).
  -h, --help           Show this help.
`);
}

function loadDotEnv(envPath) {
    if (typeof process.loadEnvFile !== 'function') return;
    try {
        process.loadEnvFile(envPath);
    } catch (err) {
        if (err && err.code && err.code !== 'ENOENT') {
            process.stderr.write(`install-local: could not read ${envPath}: ${err.code}\n`);
        }
    }
}

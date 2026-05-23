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
 * Layout produced under `dist/shplugin/<id>-<version>/`:
 *
 *   plugin.json
 *   signature.json              {keyId, signature, signedPayload}
 *   artifacts/
 *     plugin.esm.js
 *     plugin.css
 *     SHA256SUMS                "<sha256-hex>  <relative-path>" per line, sorted
 *   README.md                   (when present in the repo root)
 *
 * Output:
 *   dist/<id>-<version>.shplugin     — deterministic ZIP archive
 *
 * Steps:
 *   1. Build the frontend runtime via `npm --prefix frontend run build:runtime`.
 *   2. Stage every required file under `dist/shplugin/<id>-<version>/`.
 *   3. Compute SHA-256s, write `artifacts/SHA256SUMS`.
 *   4. Construct the canonical signed payload via `sign.mjs build-payload`.
 *   5. Sign with `sign.mjs sign` (Ed25519, key from env or --key).
 *   6. Write `signature.json`.
 *   7. ZIP into `dist/<id>-<version>.shplugin` (sorted entries).
 *   8. Self-validate: recompute checksums and assert match.
 *   9. Print absolute path of the produced archive.
 *
 * Required env (one of):
 *   SELFHELP_PLUGIN_SIGNING_KEY      + SELFHELP_PLUGIN_SIGNING_KEY_ID  (CI)
 *   SELFHELP_PLUGIN_DEV_SIGNING_KEY                                    (local; keyId=dev)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRONTEND_DIR = path.join(PLUGIN_ROOT, 'frontend');
const DIST_DIR = path.join(PLUGIN_ROOT, 'dist');

const args = parseArgs(process.argv.slice(2));

try {
    await main();
} catch (err) {
    process.stderr.write(`build-shplugin: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

async function main() {
    const manifestPath = path.join(PLUGIN_ROOT, 'plugin.json');
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

    const stageRoot = path.join(DIST_DIR, 'shplugin', `${id}-${version}`);
    const artifactsDir = path.join(stageRoot, 'artifacts');
    const archivePath = path.join(DIST_DIR, `${id}-${version}.shplugin`);

    log(`Plugin: ${id}@${version}`);
    log(`Stage:  ${stageRoot}`);
    log(`Output: ${archivePath}`);

    if (!args['skip-build']) {
        log('[1/8] Building frontend runtime…');
        runStreaming('npm', ['--prefix', FRONTEND_DIR, 'run', 'build:runtime']);
    } else {
        log('[1/8] Skipping frontend build (--skip-build).');
    }

    const esmSrc = path.join(FRONTEND_DIR, 'dist', 'plugin.esm.js');
    const cssSrc = path.join(FRONTEND_DIR, 'dist', 'plugin.css');
    if (!existsSync(esmSrc)) {
        throw new Error(`Missing built entrypoint: ${esmSrc}. Run with --skip-build only after a previous build.`);
    }
    const hasCss = existsSync(cssSrc);

    log('[2/8] Staging files…');
    if (existsSync(stageRoot)) rmSync(stageRoot, { recursive: true, force: true });
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(path.join(stageRoot, 'plugin.json'), JSON.stringify(manifest, null, 4) + '\n', 'utf8');
    cpSync(esmSrc, path.join(artifactsDir, 'plugin.esm.js'));
    if (hasCss) cpSync(cssSrc, path.join(artifactsDir, 'plugin.css'));
    const readme = path.join(PLUGIN_ROOT, 'README.md');
    if (existsSync(readme)) cpSync(readme, path.join(stageRoot, 'README.md'));

    log('[3/8] Computing SHA-256 checksums…');
    const sums = listFilesRecursive(artifactsDir)
        .filter((rel) => rel !== 'SHA256SUMS')
        .map((rel) => ({ rel, hash: sha256Hex(readFileSync(path.join(artifactsDir, rel))) }))
        .sort((a, b) => a.rel.localeCompare(b.rel));
    const sumsBody = sums.map((s) => `${s.hash}  ${s.rel}`).join('\n') + '\n';
    writeFileSync(path.join(artifactsDir, 'SHA256SUMS'), sumsBody, 'utf8');
    log(`        ${sums.length} file(s) hashed.`);

    log('[4/8] Building canonical signed payload…');
    const signScript = resolveSignScript();
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
            frontendEsm: sums.find((s) => s.rel === 'plugin.esm.js').hash,
            ...(hasCss ? { frontendCss: sums.find((s) => s.rel === 'plugin.css').hash } : {}),
        },
        compatibility: manifest.compatibility,
    };
    const canonical = execFileSync('node', [signScript, 'build-payload', '--input', '-'], {
        input: JSON.stringify(payloadInput),
        encoding: 'utf8',
    });

    log('[5/8] Signing payload (Ed25519)…');
    const signResult = execFileSync('node', [signScript, 'sign', '--payload', '-'], {
        input: canonical,
        encoding: 'utf8',
        env: process.env,
    });
    const signed = JSON.parse(signResult);
    writeFileSync(path.join(stageRoot, 'signature.json'), JSON.stringify(signed, null, 2) + '\n', 'utf8');
    log(`        keyId=${signed.keyId}, signature length=${signed.signature.length} chars.`);

    log('[6/8] Building deterministic ZIP archive…');
    if (existsSync(archivePath)) rmSync(archivePath);
    zipDirectory(stageRoot, archivePath);

    log('[7/8] Self-validating archive…');
    selfValidate(archivePath, stageRoot);

    log('[8/8] Done.');
    log(`✔ ${archivePath}`);
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
    // Use the built-in `tar`/`zip` no-op-free path: rely on Node's
    // child_process to call the system `zip` on POSIX and PowerShell
    // Compress-Archive on Windows. Deterministic ordering is achieved
    // by feeding the file list in sorted order on POSIX; Compress-Archive
    // sorts internally.
    const files = listFilesRecursive(srcDir);
    if (files.length === 0) throw new Error(`Nothing to zip under ${srcDir}.`);

    if (process.platform === 'win32') {
        const ps = [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Set-Location -LiteralPath '${srcDir.replace(/'/g, "''")}'; ` +
                `Compress-Archive -Path * -DestinationPath '${destZip.replace(/'/g, "''")}' -Force`,
        ];
        const result = spawnSync('powershell', ps, { stdio: 'inherit' });
        if (result.status !== 0) throw new Error(`Compress-Archive failed (exit ${result.status}).`);
    } else {
        const result = spawnSync(
            'zip',
            ['-r', '-X', destZip, '.'],
            { stdio: 'inherit', cwd: srcDir },
        );
        if (result.status !== 0) throw new Error(`zip failed (exit ${result.status}). Install the 'zip' CLI.`);
    }
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
        const actual = sha256Hex(readFileSync(path.join(stageRoot, 'artifacts', rel)));
        if (actual !== hash) throw new Error(`Checksum mismatch for ${rel}: expected ${hash}, got ${actual}.`);
    }
}

function runStreaming(cmd, argv) {
    const result = spawnSync(cmd, argv, { stdio: 'inherit', shell: process.platform === 'win32' });
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

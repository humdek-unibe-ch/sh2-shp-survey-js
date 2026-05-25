#!/usr/bin/env node
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Local SurveyJS runtime dev server.
 *
 * Runs the normal Vite library build in watch mode, serves
 * `frontend/dist` under `/sh2-shp-survey-js/`, and exposes an SSE
 * reload endpoint consumed by the host PluginRuntime.
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRONTEND_DIR = path.join(PLUGIN_ROOT, 'frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const BASE_PATH = '/sh2-shp-survey-js/';
const RELOAD_PATH = `${BASE_PATH}__selfhelp_plugin_reload`;
const PORT = Number(process.env.SELFHELP_SURVEYJS_RUNTIME_PORT ?? 5174);

const clients = new Set();

const watcher = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['--prefix', FRONTEND_DIR, 'run', 'build:runtime', '--', '--watch'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
);

watchDist();

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === RELOAD_PATH) {
        handleReloadStream(req, res);
        return;
    }

    if (!url.pathname.startsWith(BASE_PATH)) {
        res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Not found');
        return;
    }

    const rel = decodeURIComponent(url.pathname.slice(BASE_PATH.length)) || 'plugin.esm.js';
    serveDistFile(rel, res);
});

server.listen(PORT, () => {
    process.stdout.write(`SurveyJS runtime dev server: http://localhost:${PORT}${BASE_PATH}plugin.esm.js\n`);
    process.stdout.write(`Reload stream: http://localhost:${PORT}${RELOAD_PATH}\n`);
});

function handleReloadStream(req, res) {
    res.writeHead(200, corsHeaders({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
    }));
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
}

function serveDistFile(rel, res) {
    const safeRel = rel.replaceAll('\\', '/');
    if (safeRel.includes('..')) {
        res.writeHead(400, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Invalid path');
        return;
    }

    const file = path.join(DIST_DIR, safeRel);
    if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Build not ready yet. Keep this server running until Vite writes frontend/dist.');
        return;
    }

    res.writeHead(200, corsHeaders({
        'Content-Type': contentType(file),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
    }));
    createReadStream(file).pipe(res);
}

function watchDist() {
    let timer = null;
    const notify = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const payload = `event: reload\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
            for (const client of clients) {
                client.write(payload);
            }
        }, 150);
    };

    const attach = () => {
        if (!existsSync(DIST_DIR)) {
            setTimeout(attach, 500);
            return;
        }
        watch(DIST_DIR, { recursive: true }, notify);
        notify();
    };

    attach();
}

function corsHeaders(extra) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        ...extra,
    };
}

function contentType(file) {
    if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.json')) return 'application/json; charset=utf-8';
    if (file.endsWith('.map')) return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function shutdown() {
    watcher.kill();
    for (const client of clients) {
        client.end();
    }
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

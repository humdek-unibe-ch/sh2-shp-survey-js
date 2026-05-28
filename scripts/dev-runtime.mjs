#!/usr/bin/env node
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Local SurveyJS runtime dev server.
 *
 * Serves the plugin runtime through Vite's on-demand dev pipeline
 * instead of `vite build --watch`. That means only the requested
 * modules are transformed, which makes normal edit cycles much faster
 * than rebuilding the whole library bundle on every save.
 *
 * The host still consumes a stable entrypoint URL:
 *   http://localhost:5174/sh2-shp-survey-js/plugin.esm.js
 *
 * We also keep the lightweight SSE reload endpoint used by the host
 * PluginRuntime, because the host page does not run Vite's HMR client
 * directly.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '..');
const FRONTEND_DIR = path.join(PLUGIN_ROOT, 'frontend');
const FRONTEND_DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const FRONTEND_PACKAGE_JSON = path.join(FRONTEND_DIR, 'package.json');
const BASE_PATH = '/sh2-shp-survey-js/';
const ENTRYPOINT_PATH = `${BASE_PATH}plugin.esm.js`;
const STYLESHEET_PATH = `${BASE_PATH}plugin.css`;
const RELOAD_PATH = `${BASE_PATH}__selfhelp_plugin_reload`;
const PORT = Number(process.env.SELFHELP_SURVEYJS_RUNTIME_PORT ?? 5174);
const HOST_FRONTEND_ORIGIN = (
    process.env.SELFHELP_FRONTEND_ORIGIN ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000'
).replace(/\/+$/, '');
// Mirror of @selfhelp/shared/plugin-sdk's
// PLUGIN_RUNTIME_SHIM_BASE_PATH. Kept as a literal here because the
// dev runtime is a plain .mjs script and pulling the constant out of
// the shared package would force a CJS/ESM interop dance that is not
// worth the complexity for a single string. The TS-side
// `frontend/vite.config.ts` does read the value from the shared SDK,
// and CI (host-side) flags drift between the two via the runtime-
// shim integration tests, so this mirror cannot quietly diverge.
const HOST_RUNTIME_SHIM_PREFIX = '/api/plugins/runtime-shim/';

const clients = new Set();

const DEBUG = process.env.SELFHELP_DEV_RUNTIME_DEBUG === '1'
    || process.argv.includes('--debug');

function debug(message) {
    if (DEBUG) {
        process.stdout.write(`[dev-runtime] ${message}\n`);
    }
}

const vite = await createRuntimeViteServer();
attachReloadWatcher(vite);

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders({ 'Content-Length': '0' }));
        res.end();
        return;
    }

    if (url.pathname === RELOAD_PATH) {
        handleReloadStream(req, res);
        return;
    }

    if (url.pathname.startsWith(HOST_RUNTIME_SHIM_PREFIX)) {
        proxyHostRuntimeShim(url, req, res).catch((err) => {
            res.writeHead(502, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
            res.end(`Runtime shim proxy failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return;
    }

    if (url.pathname === STYLESHEET_PATH) {
        handleStylesheet(req, res).catch((err) => {
            res.writeHead(500, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
            res.end(`Stylesheet error: ${err instanceof Error ? err.message : String(err)}`);
        });
        return;
    }

    if (!url.pathname.startsWith(BASE_PATH)) {
        res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Not found');
        return;
    }

    req.url = rewriteRuntimeRequest(url);
    vite.middlewares(req, res, () => {
        res.writeHead(404, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        res.end('Runtime module not found');
    });
});

server.listen(PORT, () => {
    process.stdout.write(`SurveyJS runtime dev server: http://localhost:${PORT}${ENTRYPOINT_PATH}\n`);
    process.stdout.write(`Reload stream: http://localhost:${PORT}${RELOAD_PATH}\n`);
    process.stdout.write(`Runtime shim proxy: ${HOST_FRONTEND_ORIGIN}${HOST_RUNTIME_SHIM_PREFIX}*\n`);
    process.stdout.write('Mode: on-demand Vite transforms (no full library rebuild watch loop)\n');
    if (DEBUG) {
        process.stdout.write('Diagnostic mode: ON (watcher events + path filters will be logged)\n');
    } else {
        process.stdout.write('Tip: set SELFHELP_DEV_RUNTIME_DEBUG=1 (or pass --debug) to trace watcher events.\n');
    }
});

async function createRuntimeViteServer() {
    const requireFromFrontend = createRequire(FRONTEND_PACKAGE_JSON);
    let viteModulePath = null;
    try {
        viteModulePath = requireFromFrontend.resolve('vite');
    } catch {
        throw new Error(
            'Vite is not installed for frontend/. Run `npm --prefix frontend install` first.',
        );
    }

    const viteModule = await import(pathToFileURL(viteModulePath).href);
    const createViteServer = viteModule.createServer;
    if (typeof createViteServer !== 'function') {
        throw new Error('Could not load Vite createServer() from frontend dependencies.');
    }

    return createViteServer({
        root: FRONTEND_DIR,
        configFile: path.join(FRONTEND_DIR, 'vite.config.ts'),
        appType: 'custom',
        clearScreen: false,
        server: {
            middlewareMode: true,
            hmr: false,
            watch: {
                ignoreInitial: true,
            },
        },
    });
}

function rewriteRuntimeRequest(url) {
    if (url.pathname === ENTRYPOINT_PATH) {
        return `${BASE_PATH}src/index.ts${url.search}`;
    }
    return `${url.pathname}${url.search}`;
}

function attachReloadWatcher(viteServer) {
    // Defensive: explicitly tell chokidar to watch the plugin's src/
    // tree. In Vite 7 middleware mode the watcher exists from the
    // moment `createServer` resolves, but it only tracks files Vite
    // has added to its module graph (which only happens after the
    // first transform request). Adding the src directory here makes
    // sure edits fire a `change` event even if the browser tab
    // hasn't requested the entry yet, and protects against future
    // Vite versions that further narrow what middleware-mode
    // watches by default.
    const srcDir = path.join(FRONTEND_DIR, 'src');
    viteServer.watcher.add(srcDir);

    // chokidar's `ignoreInitial: true` is set on `createServer` so
    // the initial scan does not emit add events, but the catch-up
    // scan triggered by the `.add(srcDir)` call above happens
    // asynchronously and can finish AFTER the HTTP server starts
    // accepting connections. Without a startup grace window, an
    // EventSource that managed to connect in those first few ms
    // would receive a spurious reload as soon as the scan settled.
    const STARTUP_GRACE_MS = 1500;
    const startupTime = Date.now();
    let timer = null;

    const notify = (eventName, filePath) => {
        debug(`watcher.${eventName}: ${filePath ?? '(no path)'}`);
        if (Date.now() - startupTime < STARTUP_GRACE_MS) {
            debug('  → suppressed (within startup grace window)');
            return;
        }
        // Skip events outside the plugin tree (e.g. files in
        // `node_modules/.vite/deps/` that chokidar happens to
        // surface) — they cannot produce a meaningful runtime
        // change and would cause noisy reloads.
        if (eventName !== 'ready' && filePath
            && !filePath.startsWith(FRONTEND_DIR)) {
            debug(`  → ignored: path outside ${FRONTEND_DIR}`);
            return;
        }
        // CRITICAL: explicitly invalidate Vite's module graph for the
        // changed file AS IF AN HMR EVENT HAD FIRED, BEFORE broadcasting
        // the SSE reload.
        //
        // Background: tracing Vite 7's internals shows two distinct
        // invalidation timestamps on every module:
        //   - `lastInvalidationTimestamp` — set by every invalidation,
        //     including the watcher's own `onFileChange` call. Used
        //     for transform-result cache invalidation server-side.
        //   - `lastHMRTimestamp` — set ONLY when invalidation is
        //     triggered via the HMR path (i.e. `isHmr = true`).
        //
        // The import-analysis plugin appends `?t=<ts>` to inner
        // import URLs using THIS condition (Vite 7
        // `node/chunks/config.js` line ~27145):
        //   if (environment.config.consumer === "client" &&
        //       depModule.lastHMRTimestamp > 0) {
        //     url = injectQuery(url, `t=${depModule.lastHMRTimestamp}`);
        //   }
        //
        // I.e. only `lastHMRTimestamp` gates the cache-bust query on
        // child imports. Because we disable HMR in middleware mode
        // (`hmr: false`), Vite's own watcher → moduleGraph chain only
        // touches `lastInvalidationTimestamp`. The transform cache is
        // cleared server-side, but the URLs Vite emits in the entry
        // transform stay identical across reloads, so the browser
        // never refetches inner modules and the host ends up importing
        // the old function references with a "fresh" entry wrapper.
        //
        // Symptoms (matching the user's exact report):
        //   1. Watcher fires → our SSE broadcasts → host re-imports
        //      `plugin.esm.js?_shDevReload=<token>`. Vite re-transforms
        //      the entry because its URL is new.
        //   2. Entry's inner imports keep their previous URLs (no `?t=`
        //      gets appended). Browser returns inner modules from cache.
        //   3. Host calls `register()` → registration object holds OLD
        //      component refs. React diff sees the same component type
        //      as before — no remount, no visible change.
        //   4. Hard reload bypasses the browser cache and works.
        //
        // Fix: call invalidateModule() with `isHmr = true` so
        // `lastHMRTimestamp` is bumped. The next entry transform now
        // emits `?t=<newTimestamp>` on every importer of the changed
        // file. The browser refetches them, the host receives a
        // genuinely fresh module, React sees a new component type, and
        // the edit becomes visible without a hard reload.
        if (eventName !== 'ready' && filePath) {
            // CRITICAL — Windows path normalisation.
            //
            // chokidar emits the OS-native path on Windows (e.g.
            // `D:\TPF\...\SurveyAdminPage.tsx`), but Vite's
            // `fileToModulesMap` is keyed by NORMALISED forward-slash
            // paths (see Vite's own `watcher.on("change", ...)` handler
            // in `node/chunks/config.js` which calls `normalizePath(file)`
            // before doing anything). A direct `getModulesByFile()` lookup
            // with the raw chokidar path returns `undefined` on Windows
            // — the invalidation loop runs zero times, `lastHMRTimestamp`
            // never gets stamped, child import URLs stay identical
            // across reloads, and the browser keeps serving the old
            // module from cache. We normalise here so the lookup hits.
            const normalisedPath = filePath.replace(/\\/g, '/');
            try {
                const modules = viteServer.moduleGraph.getModulesByFile(normalisedPath);
                if (modules && modules.size > 0) {
                    const hmrTimestamp = Date.now();
                    const seen = new Set();
                    for (const mod of modules) {
                        // Signature: invalidateModule(mod, seen, timestamp, isHmr, softInvalidate).
                        // We pass isHmr=true so Vite stamps
                        // `lastHMRTimestamp` (the field the import-
                        // analysis plugin actually reads to inject
                        // `?t=` on child imports).
                        viteServer.moduleGraph.invalidateModule(mod, seen, hmrTimestamp, true);
                    }
                    // Log unconditionally (not only under DEBUG) so the
                    // user can see from the dev server stdout whether
                    // the moduleGraph lookup actually hit. Without this
                    // line it's invisible whether invalidation is doing
                    // anything.
                    process.stdout.write(
                        `[dev-runtime] HMR-invalidated ${modules.size} module(s) for ${normalisedPath} (t=${hmrTimestamp})\n`,
                    );
                } else {
                    // Same — log unconditionally. If this fires we know
                    // the path normalisation or the moduleGraph state
                    // is off, and the SSE reload below won't actually
                    // refresh inner modules.
                    process.stdout.write(
                        `[dev-runtime] WARNING: no Vite modules tracked for ${normalisedPath} — soft reload will likely show stale code. Hard reload (Ctrl+F5) needed until the entry has imported this file at least once.\n`,
                    );
                }
            } catch (err) {
                process.stdout.write(
                    `[dev-runtime] invalidation failed for ${normalisedPath}: ${err instanceof Error ? err.message : String(err)}\n`,
                );
            }
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
            const at = new Date().toISOString();
            const payload = `event: reload\ndata: ${JSON.stringify({ at })}\n\n`;
            let delivered = 0;
            for (const client of clients) {
                try {
                    client.write(payload);
                    delivered += 1;
                } catch (err) {
                    debug(`  → client write failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            // Always log reload broadcasts (even without DEBUG) so
            // operators can see whether the watcher fired without
            // having to set an env flag. The host EventSource side
            // is silent on success, so this is the only signal that
            // edit → SSE actually worked.
            process.stdout.write(
                `[dev-runtime] reload broadcast → ${delivered} client(s)`
                + ` (${clients.size} connected)\n`,
            );
        }, 120);
    };

    viteServer.watcher.on('ready', () => {
        debug('watcher ready; live reload armed');
    });
    viteServer.watcher.on('add', (filePath) => notify('add', filePath));
    viteServer.watcher.on('change', (filePath) => notify('change', filePath));
    viteServer.watcher.on('unlink', (filePath) => notify('unlink', filePath));
    viteServer.watcher.on('error', (err) => {
        process.stderr.write(
            `[dev-runtime] watcher error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
    });

    debug(`watcher attached; explicitly watching ${srcDir}`);
}

function handleReloadStream(req, res) {
    res.writeHead(200, corsHeaders({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        // Some reverse proxies (and the Node http stack on Windows
        // under certain edge conditions) buffer the response body
        // for compression even when Content-Type is text/event-stream.
        // Disabling X-Accel-Buffering is harmless if no nginx sits in
        // front of the dev runtime and rescues things when one does.
        'X-Accel-Buffering': 'no',
    }));
    // Initial padding + retry directive. The 2KB of `:` keep-alive
    // padding forces user-agents (and any compression middleware) to
    // flush the headers + first body chunk so EventSource sees the
    // stream as "open" immediately. `retry` tells the client how
    // long to wait before reconnecting if the stream drops.
    res.write(`retry: 1000\n: ${':'.repeat(2048)}\n\n`);
    res.write(': connected\n\n');
    clients.add(res);
    const origin = req.headers.origin ?? '(no Origin header)';
    process.stdout.write(
        `[dev-runtime] SSE client connected from ${origin}`
        + ` (${clients.size} total)\n`,
    );

    // Send a keep-alive comment every 25s so intermediaries don't
    // close an "idle" connection during long edit-free periods.
    const keepAlive = setInterval(() => {
        try {
            res.write(': ping\n\n');
        } catch {
            /* will be cleaned up on close */
        }
    }, 25000);

    req.on('close', () => {
        clearInterval(keepAlive);
        clients.delete(res);
        process.stdout.write(
            `[dev-runtime] SSE client disconnected (${clients.size} remaining)\n`,
        );
    });
}

async function proxyHostRuntimeShim(url, req, res) {
    const upstream = new URL(url.pathname + url.search, HOST_FRONTEND_ORIGIN);
    const upstreamRes = await fetch(upstream, {
        method: req.method ?? 'GET',
        headers: {
            Accept: req.headers.accept ?? '*/*',
        },
    });

    const headers = corsHeaders({
        'Cache-Control': upstreamRes.headers.get('cache-control') ?? 'no-cache, no-store, must-revalidate',
        'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/javascript; charset=utf-8',
    });
    res.writeHead(upstreamRes.status, headers);
    if (!upstreamRes.body) {
        res.end();
        return;
    }
    for await (const chunk of upstreamRes.body) {
        res.write(chunk);
    }
    res.end();
}

async function handleStylesheet(req, res) {
    const cssPath = path.join(FRONTEND_DIST_DIR, 'plugin.css');
    try {
        const css = await readFile(cssPath, 'utf-8');
        res.writeHead(200, corsHeaders({
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        }));
        res.end(css);
    } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            // CSS not built yet, return empty CSS with comment
            res.writeHead(200, corsHeaders({
                'Content-Type': 'text/css; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            }));
            res.end('/* Dev mode: CSS not built yet. Run `npm --prefix frontend run build` to generate dist/plugin.css */');
        } else {
            throw err;
        }
    }
}

function corsHeaders(extra) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        ...extra,
    };
}

async function shutdown() {
    for (const client of clients) {
        client.end();
    }
    server.close(() => process.exit(0));
    await vite.close();
}

process.on('SIGINT', () => {
    shutdown().catch(() => process.exit(0));
});
process.on('SIGTERM', () => {
    shutdown().catch(() => process.exit(0));
});

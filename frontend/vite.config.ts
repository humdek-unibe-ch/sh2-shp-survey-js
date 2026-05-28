/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Vite library-mode build for the SurveyJS runtime plugin bundle.
 *
 * Outputs:
 *   dist/plugin.esm.js   — the entrypoint the host frontend loads via
 *                         `await import(<entrypointUrl>)` at runtime.
 *   dist/plugin.css      — extracted plugin stylesheet, injected by
 *                         the host runtime with integrity + crossorigin.
 *
 * Host-provided peers (react, react-dom, mantine, @tanstack/react-query,
 * the SelfHelp shared SDK) are externalised: the host shell loads them
 * once; loading them twice would break React's reconciler. The Survey*
 * packages are bundled because the host shell does not ship them.
 *
 * The canonical list of externalised specifiers lives in
 * `@selfhelp/shared/plugin-sdk` (`PLUGIN_RUNTIME_SHIM_SPECIFIERS`) so
 * the production bundle's external set, the host's import map, the
 * host's `globalThis.__SELFHELP_RUNTIME__` stash, and the host's
 * `/api/plugins/runtime-shim/*` allowlist all describe the same
 * singletons.
 *
 * `npm run dev:runtime` serves the same bundle from
 *   http://localhost:5174/sh2-shp-survey-js/plugin.esm.js
 * which matches `plugin.json#frontend.runtime.devEntrypointUrl`. The
 * runtime-shim Vite plugin below now runs in BOTH build and dev mode
 * so the dev server's on-demand transforms also resolve `react`,
 * `@mantine/core`, etc. through the host shim — without that, the
 * dev bundle would load a SECOND React (the one in this plugin's
 * `node_modules`) and the host's hooks would detach from the
 * plugin's components, which used to manifest as broken live
 * reload.
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
    PLUGIN_RUNTIME_IMPORT_MAP,
    PLUGIN_RUNTIME_SHIM_SPECIFIERS,
    PLUGIN_RUNTIME_SHIM_BASE_PATH,
    buildPluginRuntimeShimPath,
} from '@selfhelp/shared/plugin-sdk';

const EXTERNAL_PEERS: readonly string[] = PLUGIN_RUNTIME_SHIM_SPECIFIERS;

const HOST_RUNTIME_SHIMS: Readonly<Record<string, string>> = PLUGIN_RUNTIME_IMPORT_MAP;

const SHIM_VIRTUAL_PREFIX = '\0selfhelp-runtime-shim:';

function hostRuntimeShimPlugin(): Plugin {
    return {
        name: 'selfhelp-runtime-shim',
        enforce: 'pre',
        resolveId(id: string) {
            return HOST_RUNTIME_SHIMS[id] ? `${SHIM_VIRTUAL_PREFIX}${id}` : null;
        },
        async load(id: string) {
            if (!id.startsWith(SHIM_VIRTUAL_PREFIX)) {
                return null;
            }
            const shimId = id.slice(SHIM_VIRTUAL_PREFIX.length);
            const shimUrl = HOST_RUNTIME_SHIMS[shimId];
            if (!shimUrl) {
                return null;
            }

            // In dev mode (Vite middleware via dev-runtime.mjs), Vite
            // transforms modules on demand. If we left bare specifiers
            // alone Vite's resolver would point them at this plugin's
            // own node_modules — a SECOND React/Mantine copy that the
            // host's runtime cannot see. Fetching the shim payload
            // from the host frontend and inlining it makes the
            // transformed module read directly from
            // `globalThis.__SELFHELP_RUNTIME__`, so the dev bundle
            // shares singletons with the host shell just like the
            // production bundle does through the import map.
            if (process.env.NODE_ENV !== 'production') {
                try {
                    const hostOrigin = (
                        process.env.SELFHELP_FRONTEND_ORIGIN
                        ?? process.env.NEXT_PUBLIC_APP_URL
                        ?? 'http://localhost:3000'
                    ).replace(/\/+$/, '');
                    const response = await fetch(`${hostOrigin}${shimUrl}`);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch shim from ${hostOrigin}${shimUrl}: ${response.status}`);
                    }
                    return await response.text();
                } catch (err) {
                    // Fallback: still emit a host-relative import so
                    // the browser can resolve it through the import
                    // map if the dev server fetch ever fails.
                    // eslint-disable-next-line no-console
                    console.warn(`[selfhelp-runtime-shim] Failed to inline shim for ${shimId}, falling back to import:`, err);
                    return [
                        `import * as mod from ${JSON.stringify(shimUrl)};`,
                        `export * from ${JSON.stringify(shimUrl)};`,
                        'export default mod.default;',
                    ].join('\n');
                }
            }

            // In production build mode the bundler emits a real
            // `import 'https://host/api/plugins/runtime-shim/...'`
            // statement that the browser later resolves through the
            // host's import map (or directly as an absolute URL).
            return [
                `import * as mod from ${JSON.stringify(shimUrl)};`,
                `export * from ${JSON.stringify(shimUrl)};`,
                'export default mod.default;',
            ].join('\n');
        },
    };
}

export default defineConfig(({ command }) => ({
    plugins: [
        // The shim plugin must run in BOTH dev and build so the
        // dev-runtime server and the production bundle agree on which
        // bare specifiers resolve through the host. Without it the
        // dev path silently loads duplicate React/Mantine instances
        // from this plugin's own node_modules.
        hostRuntimeShimPlugin(),
        react(),
    ],
    base: '/sh2-shp-survey-js/',
    optimizeDeps: {
        // Intentionally NOT setting `exclude: [...EXTERNAL_PEERS]`
        // here even though the shim plugin redirects every one of
        // these specifiers. Vite's dep scanner walks `src/index.ts`
        // and discovers `react`/`react-dom` as direct imports, then
        // hands them to esbuild as entry points for pre-bundling.
        // `optimizeDeps.exclude` would ALSO add them to esbuild's
        // `external` list — and esbuild refuses to be told to both
        // bundle and externalize the same id, which crashes the dev
        // server with "The entry point 'react' cannot be marked as
        // external". The shim plugin's `enforce: 'pre'` resolveId
        // hook already intercepts these specifiers BEFORE Vite's
        // pre-bundled-dep redirect runs, so the (wasted) pre-bundle
        // sitting in `node_modules/.vite/deps/` is never actually
        // loaded by the dev bundle.
    },
    server: {
        port: 5174,
        cors: true,
        strictPort: true,
    },
    build: {
        target: 'es2022',
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        cssCodeSplit: false,
        lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: () => 'plugin.esm.js',
        },
        rollupOptions: command === 'build' ? {
            external: (id: string) => {
                return EXTERNAL_PEERS.some((peer) => id === peer || id.startsWith(peer + '/'));
            },
            output: {
                paths: (id) => HOST_RUNTIME_SHIMS[id] ?? id,
                assetFileNames: (asset) =>
                    asset.name && asset.name.toLowerCase().endsWith('.css')
                        ? 'plugin.css'
                        : 'assets/[name][extname]',
            },
        } : undefined,
    },
}));

// Re-export the helper so dev-runtime.mjs (which uses plain JS) does
// not have to hardcode the base path either. Vite's TS pipeline tree-
// shakes unused exports, so this is free at runtime.
export { PLUGIN_RUNTIME_SHIM_BASE_PATH, buildPluginRuntimeShimPath };

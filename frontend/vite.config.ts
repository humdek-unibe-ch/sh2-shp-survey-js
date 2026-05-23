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
 * Host-provided peers (react, react-dom, mantine, the SelfHelp shared
 * SDK) are externalised: the host shell loads them once; loading them
 * twice would break React's reconciler. The Survey* packages are
 * bundled because the host shell does not ship them.
 *
 * `npm run dev:runtime` serves the same bundle from
 *   http://localhost:5174/sh2-shp-survey-js/plugin.esm.js
 * which matches `plugin.json#frontend.runtime.devEntrypointUrl`.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const EXTERNAL_PEERS = [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react-dom/client',
    '@mantine/core',
    '@mantine/hooks',
    '@mantine/notifications',
    '@selfhelp/shared',
    '@selfhelp/shared/plugin-sdk',
    // Optional runtime dep. The GpxMap style does `await import('leaflet').catch(...)`
    // and gracefully degrades when leaflet is not available at runtime.
    // Externalising it keeps the plugin bundle small and avoids a hard
    // build-time requirement for a peer that may not be installed.
    'leaflet',
];

export default defineConfig({
    plugins: [react()],
    base: '/sh2-shp-survey-js/',
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
        rollupOptions: {
            external: (id) => EXTERNAL_PEERS.some((peer) => id === peer || id.startsWith(peer + '/')),
            output: {
                // Rename the single merged CSS bundle to `plugin.css` so it
                // matches `plugin.json#frontend.runtime.stylesheet`. With
                // `cssCodeSplit: false` Vite emits exactly one .css asset,
                // so a simple extension match is unambiguous.
                //
                // Vite ≤ 5 named that asset `style.css`; Vite 6+ derives the
                // name from the lib name (e.g. `sh2-shp-survey-js.css`),
                // so the prior `name === 'style.css'` check silently
                // dropped the rename and parked the file under `assets/`,
                // which broke the manifest contract. Match by extension to
                // stay version-agnostic.
                assetFileNames: (asset) =>
                    asset.name && asset.name.toLowerCase().endsWith('.css')
                        ? 'plugin.css'
                        : 'assets/[name][extname]',
            },
        },
    },
});

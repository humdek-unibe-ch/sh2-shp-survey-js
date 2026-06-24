/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Vite build for the isolated SurveyJS WebView runtime.
 *
 * Bundles `src/webview` (React + survey-react-ui + survey-core, JS AND CSS)
 * into `dist/webview/` with NO external/CDN runtime assets. esbuild handles
 * the automatic JSX transform, so no `@vitejs/plugin-react` dependency is
 * required. `scripts/wrap-webview-html.mjs` then inlines the emitted JS/CSS
 * into a single self-contained HTML string (`src/webview/generated/runtimeHtml.ts`).
 *
 * React/react-dom are deduped + force-bundled (the published package lists
 * them as peers, but the WebView runs in its own document and must carry its
 * own copy). The host's React tree is the RN shell OUTSIDE the WebView.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    root: fileURLToPath(new URL('./src/webview', import.meta.url)),
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'react',
    },
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    build: {
        outDir: fileURLToPath(new URL('./dist/webview', import.meta.url)),
        emptyOutDir: true,
        target: 'es2019',
        cssCodeSplit: false,
        modulePreload: { polyfill: false },
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                entryFileNames: 'runtime.js',
                assetFileNames: 'runtime.[ext]',
            },
        },
    },
});

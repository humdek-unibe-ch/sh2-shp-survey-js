/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Inline the Vite WebView build into a single self-contained HTML string.
 *
 * Reads `dist/webview/index.html` + the emitted `runtime.js` / `runtime.css`
 * and produces ONE HTML document with the JS and CSS inlined (no external
 * references, no CDN). The result is written as a TypeScript string constant
 * to `src/webview/generated/runtimeHtml.ts`, which the tsup bundle then inlines
 * into the published package so the RN shell can feed it to
 * `react-native-webview` (native) / an iframe `srcdoc` (web export).
 *
 * Run automatically by `npm run build:webview`; never edit the generated file
 * by hand.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/webview/', import.meta.url));
const generatedFile = fileURLToPath(new URL('../src/webview/generated/runtimeHtml.ts', import.meta.url));

const htmlPath = `${distDir}index.html`;
if (!existsSync(htmlPath)) {
    throw new Error(`WebView build output not found at ${htmlPath}. Run "vite build --config vite.webview.config.ts" first.`);
}

let html = readFileSync(htmlPath, 'utf8');

// Inline <script type="module" src="runtime.js"> (and crossorigin variants).
html = html.replace(
    /<script\b[^>]*\bsrc=["']\.?\/?([^"']+\.js)["'][^>]*><\/script>/gi,
    (_match, src) => {
        const js = readFileSync(`${distDir}${src}`, 'utf8');
        return `<script type="module">\n${js}\n</script>`;
    },
);

// Inline <link rel="stylesheet" href="runtime.css">.
html = html.replace(
    /<link\b[^>]*\bhref=["']\.?\/?([^"']+\.css)["'][^>]*>/gi,
    (_match, href) => {
        const css = readFileSync(`${distDir}${href}`, 'utf8');
        return `<style>\n${css}\n</style>`;
    },
);

if (/\bsrc=["'][^"']+\.js["']/i.test(html) || /<link\b[^>]*\.css/i.test(html)) {
    throw new Error('WebView HTML still references external assets after inlining; aborting to avoid shipping a non-self-contained runtime.');
}

const header = `/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by \`npm run build:webview\` (vite build + scripts/wrap-webview-html.mjs).
 * Contains the self-contained SurveyJS WebView runtime HTML (survey-core +
 * survey-react-ui JS/CSS inlined, no CDN).
 */
`;

const body = `\nexport const SURVEYJS_WEBVIEW_HTML = ${JSON.stringify(html)};\n`;

writeFileSync(generatedFile, header + body, 'utf8');

const kib = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`wrap-webview-html: wrote ${generatedFile} (${kib} KiB self-contained HTML).`);

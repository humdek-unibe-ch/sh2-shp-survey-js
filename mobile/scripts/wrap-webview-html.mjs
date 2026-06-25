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

/**
 * Make the inlined survey-core theme CSS truly CDN-free.
 *
 * survey-core ships its default "Open Sans" theme font as @font-face rules whose
 * `src` points at https://fonts.gstatic.com — one block per weight × unicode-range
 * subset (~two dozen). The WebView/iframe CSP is `font-src data:` (no network), so
 * those fonts can NEVER load; every subset just emits a blocked-request error. In
 * the CMS web preview the runtime runs in a `srcdoc` iframe that inherits the parent
 * origin, so those failures surface in the page's own console as "fonts cannot be
 * loaded". Drop every external @font-face and alias "Open Sans" to the device's own
 * UI font, so the runtime stays self-contained and still renders in a native sans-serif.
 */
function stripExternalFonts(css) {
    const withoutCdnFaces = css.replace(/@font-face\s*\{[^{}]*\}/gi, (block) =>
        /url\(\s*["']?https?:\/\//i.test(block) ? '' : block,
    );
    const localOpenSans =
        '@font-face{font-family:"Open Sans";font-style:normal;font-weight:300 800;' +
        'src:local("Segoe UI"),local("Roboto"),local("Helvetica Neue"),local("Arial")}';
    return localOpenSans + withoutCdnFaces;
}

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
        const css = stripExternalFonts(readFileSync(`${distDir}${href}`, 'utf8'));
        return `<style>\n${css}\n</style>`;
    },
);

if (/\bsrc=["'][^"']+\.js["']/i.test(html) || /<link\b[^>]*\.css/i.test(html)) {
    throw new Error('WebView HTML still references external assets after inlining; aborting to avoid shipping a non-self-contained runtime.');
}

// Hard guard: the runtime CSP is `font-src data:` (no network), so any surviving
// font CDN reference can only ever be a blocked, console-flooding request.
if (/https?:\/\/fonts\.(?:gstatic|googleapis)\.com/i.test(html)) {
    throw new Error('WebView CSS still references an external font CDN after inlining; aborting to keep the runtime self-contained (no CDN).');
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

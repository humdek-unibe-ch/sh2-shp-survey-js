/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * WebView self-containment tests — no CDN.
 *
 * The runtime CSP is `font-src data: ; connect-src 'none'`, so any external
 * font/asset reference baked into the generated HTML can only ever be a blocked,
 * console-flooding request — and in the CMS web preview the `srcdoc` iframe
 * inherits the parent origin, so those failures surface in the page's own
 * console as "fonts cannot be loaded". survey-core's default theme ships
 * "Open Sans" as ~two dozen `@font-face` rules pointing at fonts.gstatic.com;
 * `scripts/wrap-webview-html.mjs` strips every external `@font-face` and aliases
 * "Open Sans" to the device's own UI font. This locks that in.
 */
import { describe, expect, it } from 'vitest';

import { SURVEYJS_WEBVIEW_HTML } from '../../src/webview/htmlAsset';

describe('WebView runtime is self-contained (no CDN)', () => {
    it('references no external font CDN', () => {
        expect(SURVEYJS_WEBVIEW_HTML).not.toMatch(/fonts\.gstatic\.com/i);
        expect(SURVEYJS_WEBVIEW_HTML).not.toMatch(/fonts\.googleapis\.com/i);
    });

    it('declares no @font-face that loads over the network', () => {
        const fontFaces = SURVEYJS_WEBVIEW_HTML.match(/@font-face\s*\{[^{}]*\}/gi) ?? [];
        expect(fontFaces.length).toBeGreaterThan(0);
        for (const face of fontFaces) {
            expect(face).not.toMatch(/url\(\s*["']?https?:\/\//i);
        }
    });

    it('aliases the theme font to a local device font', () => {
        expect(SURVEYJS_WEBVIEW_HTML).toMatch(/@font-face\{font-family:"Open Sans";[^}]*src:local\(/i);
    });

    it('keeps the locked-down CSP (font-src data:, connect-src none)', () => {
        expect(SURVEYJS_WEBVIEW_HTML).toMatch(/font-src data:/i);
        expect(SURVEYJS_WEBVIEW_HTML).toMatch(/connect-src 'none'/i);
    });
});

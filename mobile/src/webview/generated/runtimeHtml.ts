/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 *
 * `npm run build:webview` compiles `src/webview` with Vite into one
 * self-contained HTML (SurveyJS JS + CSS inlined, no CDN), then
 * `scripts/wrap-webview-html.mjs` rewrites this file with that HTML as a string
 * constant. This committed PLACEHOLDER is intentionally tiny so the repo stays
 * light and so `tsc`, vitest, and the tsup bundle resolve before the WebView is
 * built; `npm run build` always runs `build:webview` before `tsup`, so the
 * published `dist` carries the real runtime. Do NOT commit the multi-MB built
 * version of this file. If this placeholder ever reaches a device it posts a
 * RUNTIME_ERROR instead of rendering.
 */

export const SURVEYJS_WEBVIEW_HTML =
    '<!doctype html><html><head><meta charset="utf-8" /><title>SurveyJS</title></head>' +
    '<body><div id="root"></div><script>' +
    "var m={source:'sh2-surveyjs',type:'RUNTIME_ERROR',message:'SurveyJS WebView runtime asset was not built (run build:webview).'};" +
    'try{if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}' +
    "else if(window.parent&&window.parent!==window){window.parent.postMessage(m,'*');}}catch(e){}" +
    '</script></body></html>';

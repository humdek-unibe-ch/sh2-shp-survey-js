/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public accessor for the self-contained SurveyJS WebView runtime HTML.
 *
 * The native RN shell loads this string into `react-native-webview`
 * (`source={{ html }}`) on native and into a `srcdoc` iframe on web export.
 * The string is the Vite single-file bundle (SurveyJS JS + CSS inlined, no
 * CDN/network for the runtime itself). See `generated/runtimeHtml.ts`.
 */

export { SURVEYJS_WEBVIEW_HTML } from './generated/runtimeHtml';

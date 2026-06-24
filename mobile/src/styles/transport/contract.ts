/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Platform-agnostic contract between the SurveyJS RN shell and its WebView
 * transport. Two implementations exist — `SurveyWebViewNative` (uses
 * `react-native-webview`) and `SurveyWebViewWeb` (uses an `<iframe>`); the
 * shell picks one at runtime by `Platform.OS` and lazy-`require`s it so the
 * native module is never evaluated on web (and vice-versa).
 *
 * Both transports do the SAME two jobs: load the self-contained runtime HTML
 * and shuttle bridge messages. They expose `setPost` so the shell can send
 * host->webview messages, and call `onMessage` for every webview->host
 * message (string on native, object on web — the shell normalises both).
 */

export interface IWebViewTransportProps {
    /** Self-contained runtime HTML (survey-core + survey-react-ui inlined). */
    html: string;
    /** Measured content height (px) reported by the runtime via `RESIZE`. */
    height: number;
    /** Called with each inbound webview->host payload (string or object). */
    onMessage: (raw: unknown) => void;
    /** Hands the shell the function that posts a JSON string INTO the runtime. */
    setPost: (post: (json: string) => void) => void;
    /**
     * Security gate: returns true only for URLs the WebView may load itself
     * (the srcdoc/about:blank bootstrap). Everything else is blocked — real
     * redirects go through the native host (`REQUEST_REDIRECT`).
     */
    isAllowedUrl: (url: string) => boolean;
}

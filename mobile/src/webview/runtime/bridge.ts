/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Bridge transport for the isolated WebView runtime (browser side).
 *
 * Outbound (runtime -> host):
 *   - native:  `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`
 *   - web/iframe: `window.parent.postMessage(msg, '*')`
 *
 * Inbound (host -> runtime): both `react-native-webview` (which dispatches a
 * `document`/`window` `message` event with a string `data`) and the iframe
 * `postMessage` (object `data`) are accepted, parsed, and validated against
 * the typed host->webview contract. Anything that fails the guard is dropped.
 *
 * This file is built ONLY by the WebView Vite bundle (it touches `window` /
 * `document`), so it is excluded from the package's `tsc` (no DOM lib) and
 * relies on esbuild for transpilation.
 */

import {
    type THostToWebviewMessage,
    type TWebviewToHostMessage,
    isHostToWebviewMessage,
} from '../../bridge/messages';

interface IReactNativeWebView {
    postMessage(payload: string): void;
}

export interface IRuntimeBridge {
    post(message: TWebviewToHostMessage): void;
    dispose(): void;
}

export function createRuntimeBridge(onMessage: (message: THostToWebviewMessage) => void): IRuntimeBridge {
    const rnWebView = (window as unknown as { ReactNativeWebView?: IReactNativeWebView }).ReactNativeWebView;

    const post = (message: TWebviewToHostMessage): void => {
        if (rnWebView && typeof rnWebView.postMessage === 'function') {
            rnWebView.postMessage(JSON.stringify(message));
            return;
        }
        if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, '*');
        }
    };

    const handleEvent = (event: Event): void => {
        const raw = (event as MessageEvent).data;
        let parsed: unknown = raw;
        if (typeof raw === 'string') {
            try {
                parsed = JSON.parse(raw);
            } catch {
                return; // not our protocol — ignore
            }
        }
        if (isHostToWebviewMessage(parsed)) {
            onMessage(parsed);
        }
    };

    // react-native-webview injects to `document`; iframe posts to `window`.
    window.addEventListener('message', handleEvent);
    document.addEventListener('message', handleEvent as EventListener);

    return {
        post,
        dispose() {
            window.removeEventListener('message', handleEvent);
            document.removeEventListener('message', handleEvent as EventListener);
        },
    };
}

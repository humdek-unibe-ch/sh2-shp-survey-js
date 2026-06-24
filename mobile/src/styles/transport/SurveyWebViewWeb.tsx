/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Web-export WebView transport backed by an `<iframe srcDoc>`.
 *
 * `react-native-webview` has no web implementation, so the Expo web export
 * (react-native-web → react-dom) renders the SAME self-contained runtime HTML
 * in a sandboxed iframe and uses `window.postMessage` for the bridge.
 *
 * This file uses the DOM, so it is EXCLUDED from the package `tsc` (the mobile
 * tsconfig has no DOM lib) and compiled only by tsup/esbuild + Metro web. It
 * is lazy-`require`d by `SurveyJsStyle` ONLY on web. The iframe is sandboxed
 * (`allow-scripts allow-same-origin`) and the runtime HTML carries a strict
 * CSP (`connect-src 'none'`), so the runtime cannot reach the network — every
 * authenticated call goes through the native host.
 */

import { useEffect, useRef } from 'react';

import type { IWebViewTransportProps } from './contract';

export function SurveyWebViewWeb({
    html,
    height,
    onMessage,
    setPost,
    isAllowedUrl,
}: IWebViewTransportProps): React.ReactElement {
    const ref = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
        setPost((json: string) => {
            const win = ref.current?.contentWindow;
            if (win) win.postMessage(JSON.parse(json), '*');
        });
    }, [setPost]);

    useEffect(() => {
        const handler = (event: MessageEvent): void => {
            if (ref.current && event.source === ref.current.contentWindow) {
                onMessage(event.data);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onMessage]);

    // `isAllowedUrl` is enforced by the iframe CSP + sandbox on web; referenced
    // here to keep the transport contract identical across platforms.
    void isAllowedUrl;

    return (
        <iframe
            ref={ref}
            srcDoc={html}
            title="SurveyJS"
            sandbox="allow-scripts allow-same-origin allow-forms"
            style={{ width: '100%', height, border: '0', background: 'transparent' }}
        />
    );
}

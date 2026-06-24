/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Native WebView transport (iOS / Android) backed by `react-native-webview`.
 *
 * Lazy-`require`d by `SurveyJsStyle` ONLY on native, so the native module is
 * never evaluated on the web export. Security posture:
 *   - loads the self-contained HTML via `source={{ html }}` (no remote URL),
 *   - `originWhitelist` is scoped to `about:blank` (not `*`),
 *   - `onShouldStartLoadWithRequest` blocks every navigation the shell did not
 *     explicitly allow (real redirects go through the native host, not the
 *     WebView), and
 *   - DOM storage is left off; the runtime needs no persistent storage.
 */

import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import type { IWebViewTransportProps } from './contract';

export function SurveyWebViewNative({
    html,
    height,
    onMessage,
    setPost,
    isAllowedUrl,
}: IWebViewTransportProps): React.ReactElement {
    const ref = useRef<WebView>(null);

    useEffect(() => {
        setPost((json: string) => {
            ref.current?.postMessage(json);
        });
    }, [setPost]);

    return (
        <WebView
            ref={ref}
            originWhitelist={['about:blank']}
            source={{ html }}
            onMessage={(event: WebViewMessageEvent) => onMessage(event.nativeEvent.data)}
            onShouldStartLoadWithRequest={(request) => isAllowedUrl(request.url)}
            javaScriptEnabled
            domStorageEnabled={false}
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            style={{ height, backgroundColor: 'transparent' }}
        />
    );
}

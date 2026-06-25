/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * WebView security tests — navigation allow-list.
 *
 * `isAllowedWebViewUrl` is wired into the native transport's
 * `onShouldStartLoadWithRequest` (`SurveyWebViewNative.tsx`), so it is the
 * enforcement point for the plan's WebView security requirements:
 *   - only the self-contained runtime document may load (no remote origin),
 *   - no arbitrary navigation — unknown/external URLs are blocked,
 *   - real (external) redirects never happen via WebView navigation; they go
 *     through the native host (`REQUEST_REDIRECT` -> host), which this guard
 *     forces by refusing every off-document navigation.
 *
 * The companion typed-message-shape boundary is covered by
 * `__tests__/bridge/messages.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { chooseRedirectAction, isAllowedWebViewUrl } from '../../src/styles/SurveyJsStyle';

describe('WebView navigation allow-list', () => {
    it('allows only the self-contained runtime document load', () => {
        for (const url of ['', 'about:blank', 'about:srcdoc', 'data:text/html,<p>x</p>']) {
            expect(isAllowedWebViewUrl(url)).toBe(true);
        }
    });

    it('blocks every external / arbitrary navigation', () => {
        const blocked = [
            'https://evil.example.com',
            'https://cms.example.com/cms-api/v1/plugins/sh2-shp-survey-js/surveys',
            'http://intranet.local/',
            'file:///etc/passwd',
            'javascript:alert(1)',
            'intent://scan/#Intent;scheme=zxing;end',
            'ftp://files.example.com/x',
            'about:blankX',
            'about:config',
            'blob:https://evil.example.com/abc',
        ];
        for (const url of blocked) {
            expect(isAllowedWebViewUrl(url)).toBe(false);
        }
    });
});

describe('survey redirect routing (chooseRedirectAction)', () => {
    // When the host exposes navigate() (renderer >= 0.3.0) EVERY redirect routes
    // through the host router — internal AND external, web AND native. This is
    // the fix: the plugin never touches window.location, so the live-preview
    // iframe is no longer navigated (and broken) by an in-content redirect.
    it('routes through the host on a 0.3.0 host regardless of platform/target', () => {
        expect(chooseRedirectAction(true, true, 'thank-you', false)).toEqual({
            kind: 'host',
            target: 'thank-you',
            external: false,
        });
        expect(chooseRedirectAction(true, false, 'thank-you', false)).toEqual({
            kind: 'host',
            target: 'thank-you',
            external: false,
        });
        expect(chooseRedirectAction(true, true, 'https://example.com', true)).toEqual({
            kind: 'host',
            target: 'https://example.com',
            external: true,
        });
    });

    // Legacy host (renderer < 0.3.0, no navigate): external still opens, but an
    // internal redirect on web falls back to the same-window assign (the old
    // "weird preview redirect") and on native is unsupported.
    it('degrades gracefully on a host that predates navigate()', () => {
        expect(chooseRedirectAction(false, false, 'https://example.com', true)).toEqual({
            kind: 'external',
            target: 'https://example.com',
        });
        expect(chooseRedirectAction(false, true, 'thank-you', false)).toEqual({
            kind: 'web-assign',
            target: 'thank-you',
        });
        expect(chooseRedirectAction(false, false, 'thank-you', false)).toEqual({
            kind: 'unsupported',
            target: 'thank-you',
        });
    });
});

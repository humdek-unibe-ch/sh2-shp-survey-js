/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Typed bridge contract tests (WebView <-> native host).
 *
 * The bridge is a security boundary: each side validates EVERY inbound message
 * against the expected shape and drops anything else (no `eval`, no trusting
 * arbitrary data). These tests assert the guards accept well-formed intents /
 * results and reject malformed, wrong-source, wrong-direction, and hostile
 * payloads.
 */

import { describe, expect, it } from 'vitest';

import {
    BRIDGE_SOURCE,
    isHostToWebviewMessage,
    isWebviewToHostMessage,
} from '../../src/bridge/messages';

describe('isWebviewToHostMessage', () => {
    it('accepts well-formed intents', () => {
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'READY', protocolVersion: 1 })).toBe(true);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'LOAD_SURVEY', surveyKey: 'k' })).toBe(true);
        expect(
            isWebviewToHostMessage({
                source: BRIDGE_SOURCE,
                type: 'SAVE_PROGRESS',
                responseId: 'R_1',
                pageNo: 2,
                data: { q: 1 },
            }),
        ).toBe(true);
        expect(
            isWebviewToHostMessage({
                source: BRIDGE_SOURCE,
                type: 'SUBMIT_SURVEY',
                responseId: null,
                data: {},
                enforce: {},
            }),
        ).toBe(true);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'RESIZE', height: 640 })).toBe(true);
        expect(
            isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'REQUEST_REDIRECT', target: '/x', external: false }),
        ).toBe(true);
    });

    it('rejects malformed / hostile / wrong-direction payloads', () => {
        expect(isWebviewToHostMessage(null)).toBe(false);
        expect(isWebviewToHostMessage('READY')).toBe(false);
        expect(isWebviewToHostMessage({ source: 'evil', type: 'READY' })).toBe(false);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'NOPE' })).toBe(false);
        // missing required fields
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'LOAD_SURVEY' })).toBe(false);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'SAVE_PROGRESS', responseId: 'R', pageNo: '2', data: {} })).toBe(false);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'RESIZE', height: 'tall' })).toBe(false);
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'REQUEST_REDIRECT', target: '/x', external: 'no' })).toBe(false);
        // a host->webview type is NOT a valid webview->host message
        expect(isWebviewToHostMessage({ source: BRIDGE_SOURCE, type: 'SURVEY_LOADED', definition: {}, state: {} })).toBe(false);
    });
});

describe('isHostToWebviewMessage', () => {
    it('accepts well-formed results / inputs', () => {
        expect(
            isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'INIT', surveyKey: 'k', config: {} }),
        ).toBe(true);
        expect(
            isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SURVEY_LOADED', definition: {}, state: {} }),
        ).toBe(true);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'PROGRESS_SAVED', ok: true })).toBe(true);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SUBMIT_RESULT', ok: true })).toBe(true);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SESSION_EXPIRED' })).toBe(true);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SET_LOCALE', locale: 'de' })).toBe(true);
    });

    it('rejects malformed / wrong-direction payloads', () => {
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'INIT', surveyKey: 'k' })).toBe(false);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SURVEY_LOADED', definition: {} })).toBe(false);
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'SET_LOCALE' })).toBe(false);
        // a webview->host type is NOT a valid host->webview message
        expect(isHostToWebviewMessage({ source: BRIDGE_SOURCE, type: 'LOAD_SURVEY', surveyKey: 'k' })).toBe(false);
    });
});

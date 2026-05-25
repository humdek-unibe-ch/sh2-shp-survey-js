/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractUrlParams } from '../src/runtime/urlParams';

describe('extractUrlParams', () => {
    let originalHref: string;

    beforeEach(() => {
        originalHref = window.location.href;
    });

    afterEach(() => {
        window.history.replaceState(null, '', originalHref);
    });

    it('returns user-provided params keyed by name', () => {
        window.history.replaceState(null, '', '/?lang=en&code=abc');
        expect(extractUrlParams()).toEqual({ lang: 'en', code: 'abc' });
    });

    it('drops the reserved keys to prevent flow tampering', () => {
        window.history.replaceState(
            null,
            '',
            '/?lang=en&responseId=secret&record_id=99&code=abc',
        );
        const params = extractUrlParams();
        expect(params).toEqual({ lang: 'en', code: 'abc' });
        expect(params.responseId).toBeUndefined();
        expect(params.record_id).toBeUndefined();
    });
});

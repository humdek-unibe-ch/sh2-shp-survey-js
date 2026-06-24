/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Unit coverage for the interactive mobile runtime's pure helpers — the
 * parts that decide HOW the survey behaves without rendering React:
 *   - `buildRuntimeConfigFromSection` reads the SAME CMS style fields the
 *     web runtime does (redirect, autosave, once-per-*, schedule labels),
 *   - `resolveApiBase` targets the web-preview proxy / host-injected base,
 *   - `isOutsideSchedule` / `stripHtml` back the lifecycle states.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { resolveApiBase } from '../../src/api/surveys';
import { buildRuntimeConfigFromSection, extractFieldString } from '../../src/styles/section';
import { isOutsideSchedule, stripHtml } from '../../src/styles/SurveyJsRuntimeStyle';

describe('buildRuntimeConfigFromSection', () => {
    it('reads redirect + per-page save + once-per-user from CMS fields', () => {
        const config = buildRuntimeConfigFromSection({
            id: 1,
            fields: {
                redirect_at_end: '/thank-you',
                auto_save_interval: '15',
                once_per_user: '1',
                allow_anonymous: '0',
            },
        });
        expect(config.redirectAtEnd).toBe('/thank-you');
        expect(config.autoSaveIntervalSeconds).toBe(15);
        expect(config.oncePerUser).toBe(true);
        expect(config.allowAnonymous).toBe(false);
    });

    it('applies safe defaults and supports the CMS { content } field shape', () => {
        const config = buildRuntimeConfigFromSection({
            id: 2,
            fields: { redirect_at_end: { content: '  /done  ' } },
        });
        expect(config.redirectAtEnd).toBe('/done');
        expect(config.autoSaveIntervalSeconds).toBe(0);
        expect(config.oncePerUser).toBe(false);
        expect(config.allowAnonymous).toBe(true);
        expect(extractFieldString({ fields: { x: '' } }, 'x')).toBeNull();
    });
});

describe('resolveApiBase', () => {
    afterEach(() => {
        delete (globalThis as { __SELFHELP_API_BASE__?: unknown }).__SELFHELP_API_BASE__;
    });

    it('prefers a host-injected base and trims trailing slashes', () => {
        (globalThis as { __SELFHELP_API_BASE__?: unknown }).__SELFHELP_API_BASE__ =
            'https://cms.example.com/mobile-preview/api/';
        expect(resolveApiBase()).toBe('https://cms.example.com/mobile-preview/api');
    });

    it('returns an empty base in a non-browser context (relative fallback)', () => {
        expect(resolveApiBase()).toBe('');
    });
});

describe('isOutsideSchedule', () => {
    it('treats an unset / 00:00 window as always active', () => {
        expect(isOutsideSchedule({ startTime: null, endTime: null })).toBe(false);
        expect(isOutsideSchedule({ startTime: '00:00', endTime: '00:00' })).toBe(false);
    });
});

describe('stripHtml', () => {
    it('reduces editor HTML labels to plain text and nulls empty content', () => {
        expect(stripHtml('<p>Already <strong>done</strong></p>')).toBe('Already done');
        expect(stripHtml('<p>&nbsp;</p>')).toBeNull();
        expect(stripHtml(null)).toBeNull();
    });
});

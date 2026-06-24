/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Unit coverage for the mobile runtime's pure helpers — the parts that decide
 * HOW the survey behaves without rendering React:
 *   - `buildRuntimeConfigFromSection` reads the SAME CMS style fields the web
 *     runtime does (redirect, autosave, once-per-*, schedule labels),
 *   - `buildEnforcePayload` produces the server-revalidated submit contract,
 *   - `isOutsideSchedule` / `stripHtml` back the lifecycle states.
 *
 * Auth/network is no longer the renderer's concern (the native host owns it via
 * `MobileHostServices`), so the old `resolveApiBase` coverage is gone.
 */

import { describe, expect, it } from 'vitest';

import { buildEnforcePayload, isOutsideSchedule, newResponseId, stripHtml } from '../../src/runtime/lifecycle';
import {
    buildRuntimeConfigFromSection,
    extractFieldString,
    extractSurveyId,
} from '../../src/styles/section';

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

describe('extractSurveyId', () => {
    it('reads the survey-js field (string + { content } shapes) and nulls blanks', () => {
        expect(extractSurveyId({ id: 1, fields: { 'survey-js': 'survey-42' } })).toBe('survey-42');
        expect(extractSurveyId({ id: 1, fields: { 'survey-js': { content: '  s-7  ' } } })).toBe('s-7');
        expect(extractSurveyId({ id: 1, fields: { 'survey-js': '   ' } })).toBeNull();
        expect(extractSurveyId({ id: 1 })).toBeNull();
    });
});

describe('buildEnforcePayload', () => {
    it('mirrors the once-per-user gate + finished progress into the submit contract', () => {
        const config = buildRuntimeConfigFromSection({
            id: 3,
            fields: { once_per_user: '1', allow_anonymous: '0' },
        });
        const enforce = buildEnforcePayload(config, 'R_ABC', 2);
        expect(enforce.oncePerUser).toBe(true);
        expect(enforce.allowAnonymous).toBe(false);
        expect(enforce.responseId).toBe('R_ABC');
        expect(enforce.editMode).toBe(false);
        expect(enforce.progress).toEqual({ pageNo: 2, triggerType: 'finished' });
    });

    it('omits a schedule window when once-per-schedule is off', () => {
        const config = buildRuntimeConfigFromSection({ id: 4, fields: {} });
        const enforce = buildEnforcePayload(config, null, 0);
        expect(enforce.windowStart).toBeNull();
        expect(enforce.windowEnd).toBeNull();
        expect(enforce.responseId).toBeUndefined();
    });
});

describe('newResponseId', () => {
    it('produces a unique R_-prefixed id', () => {
        const a = newResponseId();
        const b = newResponseId();
        expect(a).toMatch(/^R_[0-9A-F]{16}$/);
        expect(a).not.toBe(b);
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

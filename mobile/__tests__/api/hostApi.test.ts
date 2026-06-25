/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * SurveyJS mobile API client tests (host-services backed).
 *
 * The mobile renderer never owns authenticated network access: every call goes
 * through `IMobileHostServices.request`. These tests use a recording fake host
 * to assert the client:
 *   - targets the correct plugin route + method,
 *   - unwraps the SelfHelp API envelope (`data.data` -> inner payload),
 *   - builds the `extraParams[...]` query + the runtime-config echo as a
 *     `config` QUERY param (NOT a custom header — a custom request header
 *     trips the backend CORS allow-list and fails cross-origin with a
 *     "Network Error"; the query form is CORS-safe and the backend reads it),
 *   - maps non-ok responses to `SurveyHostError` with the backend `reason`,
 *   - flags session expiry so the shell can branch.
 */

import { describe, expect, it } from 'vitest';

import type { IMobileHostRequest, IMobileHostResponse, IMobileHostServices } from '@selfhelp/shared/plugin-sdk';
import {
    SurveyHostError,
    fetchDraft,
    loadPublishedSurvey,
    saveProgress,
    submitSurvey,
} from '../../src/api/surveys';

function recordingHost(
    responder: (req: IMobileHostRequest) => IMobileHostResponse,
): { host: IMobileHostServices; calls: IMobileHostRequest[] } {
    const calls: IMobileHostRequest[] = [];
    const host: IMobileHostServices = {
        apiBaseUrl: () => 'https://cms.example.com',
        getAccessToken: () => 'token',
        request: async <TData>(req: IMobileHostRequest): Promise<IMobileHostResponse<TData>> => {
            calls.push(req);
            return responder(req) as IMobileHostResponse<TData>;
        },
    };
    return { host, calls };
}

const ok = (data: unknown): IMobileHostResponse => ({ ok: true, status: 200, data: { data } });

describe('loadPublishedSurvey', () => {
    it('GETs the published route, echoes runtime config in the query, and unwraps the envelope', async () => {
        const { host, calls } = recordingHost(() =>
            ok({ surveyId: 'k', definition: { pages: [] }, tokens: {}, extraParams: {} }),
        );
        const published = await loadPublishedSurvey(host, 'my key', { oncePerUser: true }, { foo: 'bar' });

        expect(published.surveyId).toBe('k');
        const req = calls[0];
        expect(req.method).toBe('GET');
        expect(req.path).toBe('/cms-api/v1/plugins/sh2-shp-survey-js/published/my%20key');
        // Config travels as the `config` query param (CORS-safe), and NO custom
        // request header is sent (a custom header trips the backend CORS
        // allow-list and fails cross-origin with "Network Error").
        expect(req.query).toEqual({
            'extraParams[foo]': 'bar',
            config: JSON.stringify({ oncePerUser: true }),
        });
        expect(req.headers).toBeUndefined();
    });
});

describe('saveProgress / fetchDraft', () => {
    it('PUTs progress and GETs the draft on the progress route', async () => {
        const { host, calls } = recordingHost((req) =>
            req.method === 'PUT'
                ? ok({ responseId: 'R_1', pageNo: 1, payload: {}, lastSavedAt: 't', expiresAt: 't' })
                : ok({ responseId: 'R_1', pageNo: 1, payload: { data: { q: 1 } }, lastSavedAt: 't', expiresAt: 't' }),
        );

        const saved = await saveProgress(host, 'k', { responseId: 'R_1', pageNo: 1, payload: { q: 1 } });
        expect(saved.responseId).toBe('R_1');
        expect(calls[0].method).toBe('PUT');
        expect(calls[0].path).toBe('/cms-api/v1/plugins/sh2-shp-survey-js/published/k/progress');

        const draft = await fetchDraft(host, 'k', 'R_1');
        expect(draft?.responseId).toBe('R_1');
        expect(calls[1].method).toBe('GET');
        expect(calls[1].query).toEqual({ responseId: 'R_1' });
    });
});

describe('submitSurvey', () => {
    it('POSTs answers + enforce and returns the inner result', async () => {
        const { host, calls } = recordingHost(() => ok({ runId: 7, responseId: 'R_9', submittedAt: '2026-06-24T00:00:00Z' }));
        const result = await submitSurvey(host, 'k', { q1: 'a' }, { oncePerUser: true });

        expect(result.responseId).toBe('R_9');
        expect(calls[0].method).toBe('POST');
        expect(calls[0].path).toBe('/cms-api/v1/plugins/sh2-shp-survey-js/published/k/submit');
        expect(calls[0].body).toEqual({ answers: { q1: 'a' }, enforce: { oncePerUser: true } });
    });

    it('maps a backend lifecycle error to SurveyHostError with its reason', async () => {
        const { host } = recordingHost(() => ({
            ok: false,
            status: 409,
            data: { reason: 'already_submitted_once' },
            reason: 'already_submitted_once',
            error: 'Already submitted',
        }));
        await expect(submitSurvey(host, 'k', {})).rejects.toMatchObject({
            name: 'SurveyHostError',
            status: 409,
            reason: 'already_submitted_once',
            sessionExpired: false,
        });
    });

    it('flags session expiry on an unrecoverable 401', async () => {
        const { host } = recordingHost(() => ({ ok: false, status: 401, data: null, sessionExpired: true }));
        const err = await submitSurvey(host, 'k', {}).catch((e) => e);
        expect(err).toBeInstanceOf(SurveyHostError);
        expect((err as SurveyHostError).sessionExpired).toBe(true);
    });
});

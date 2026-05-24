/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Thin fetch wrappers around the public SurveyJS API endpoints.
 *
 * The plugin does NOT use the host's `permissionAwareApiClient`
 * because plugin packages must stay decoupled from internal CMS
 * services. Anonymous reads + same-origin submission are sufficient
 * for the public flow; admin flows live in `api/surveys-admin.ts`.
 */

export interface IPublishedSurvey {
    surveyId: number;
    keySlug: string;
    name: string;
    themeCode: string | null;
    revision: number;
    definition: Record<string, unknown>;
}

export interface ISubmitResult {
    runId: number;
    submittedAt: string;
}

const BASE = '/cms-api/v1/plugins/sh2-shp-survey-js';

export async function fetchPublishedSurvey(key: string): Promise<IPublishedSurvey> {
    const res = await fetch(`${BASE}/published/${encodeURIComponent(key)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data: IPublishedSurvey };
    return body.data;
}

export async function submitSurveyAnswers(
    key: string,
    answers: Record<string, unknown>,
): Promise<ISubmitResult> {
    const res = await fetch(`${BASE}/published/${encodeURIComponent(key)}/submit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answers }),
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data: ISubmitResult };
    return body.data;
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Admin Surveys API client.
 *
 * Used by the survey admin screens mounted under
 * `/admin/plugins-host/sh2-shp-survey-js/surveys`. Calls go through the
 * host's BFF proxy (below); the pages stay free of HTTP boilerplate.
 */

import { csrfHeaders } from './csrf';

/** What the caller may do with a survey; the server checks again on every call. */
export interface IAdminSurveyRights {
    update: boolean;
    publish: boolean;
    delete: boolean;
}

export interface IAdminSurveySummary {
    id: number;
    surveyId: string;
    name: string;
    themeCode: string | null;
    archived: boolean;
    updatedAt: string;
    currentRevision: number | null;
    draftHash: string | null;
    draftUpdatedAt: string | null;
    draftUpdatedByUserId: number | null;
    /** Null when the caller may not read the answers (no grant on the data table). */
    responseCount: number | null;
    /** The answers' table in the core data screen; null before the first response or without the grant. */
    dataTableId: number | null;
    rights: IAdminSurveyRights;
}

export interface IAdminSurveyList {
    items: IAdminSurveySummary[];
    canCreate: boolean;
}

export interface IAdminSurveyDetail extends IAdminSurveySummary {
    definition: Record<string, unknown> | null;
    publishedDefinition?: Record<string, unknown> | null;
}

export interface IAdminSurveyVersion {
    id: number;
    revision: number;
    createdAt: string;
    createdByUserId: number | null;
    definitionSha256: string;
}

export interface IAdminSurveyVersionDetail extends IAdminSurveyVersion {
    definition: Record<string, unknown>;
}

// Browser-side admin calls go through the host's Next.js BFF proxy
// (`src/app/api/[...path]/route.ts`), which:
//   - validates the CSRF double-submit cookie for unsafe methods,
//   - attaches the httpOnly `sh_auth` (or `sh_impersonate`) JWT as
//     `Authorization: Bearer ...` before forwarding,
//   - prepends `/cms-api/v1` and points the request at the Symfony
//     backend (`SYMFONY_INTERNAL_URL`).
//
// Calling `/cms-api/v1/...` directly from the browser would bypass
// the proxy entirely — the browser would hit the Next.js dev server
// (which has no such route) and 404. The plugin therefore uses the
// BFF-relative `/api/...` form here. Keep paths after `/api/` in
// sync with the admin entries in `plugin.json#apiRoutes` — those
// are the single source of truth the host installer persists into
// `api_routes`.
const BASE = '/api/admin/plugins/sh2-shp-survey-js';

/**
 * A refused admin call. `reason` is the server's `data.reason` when it gives
 * one, e.g. `draft_conflict` or `answered_question_renamed` on a save or
 * publish.
 */
export class SurveyApiError extends Error {
    constructor(message: string, readonly status: number, readonly reason: string | null = null) {
        super(message);
        this.name = 'SurveyApiError';
    }
}

async function asJson<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!res.ok) {
        const data = body.data as { reason?: unknown } | null | undefined;
        const reason = typeof data?.reason === 'string' ? data.reason : null;
        throw new SurveyApiError(body.error ?? `HTTP ${res.status}`, res.status, reason);
    }
    if (body.data === undefined) {
        throw new Error('Response missing data envelope.');
    }
    return body.data;
}

export async function listSurveys(): Promise<IAdminSurveyList> {
    const res = await fetch(`${BASE}/surveys`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IAdminSurveyList>(res);
}

export async function getSurvey(id: number): Promise<IAdminSurveyDetail> {
    const res = await fetch(`${BASE}/surveys/${id}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IAdminSurveyDetail>(res);
}

export async function createSurvey(body: {
    name: string;
    definition?: Record<string, unknown>;
}): Promise<IAdminSurveySummary> {
    const res = await fetch(`${BASE}/surveys`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(body),
    });
    return asJson<IAdminSurveySummary>(res);
}

export async function publishVersion(
    id: number,
    body: { definition?: Record<string, unknown>; expectedDraftHash?: string | null; force?: boolean } = {},
): Promise<{ id: number; surveyId: string; revision: number; createdAt: string; draftHash: string | null }> {
    const res = await fetch(`${BASE}/surveys/${id}/versions`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(body),
    });
    return asJson<{ id: number; surveyId: string; revision: number; createdAt: string; draftHash: string | null }>(res);
}

export async function saveDraft(
    id: number,
    body: { definition: Record<string, unknown>; expectedDraftHash?: string | null; force?: boolean },
): Promise<IAdminSurveyDetail> {
    const res = await fetch(`${BASE}/surveys/${id}/draft`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(body),
    });
    return asJson<IAdminSurveyDetail>(res);
}

export async function listVersions(id: number): Promise<IAdminSurveyVersion[]> {
    const res = await fetch(`${BASE}/surveys/${id}/versions`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IAdminSurveyVersion[]>(res);
}

export async function getVersion(id: number, versionId: number): Promise<IAdminSurveyVersionDetail> {
    const res = await fetch(`${BASE}/surveys/${id}/versions/${versionId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IAdminSurveyVersionDetail>(res);
}

export async function restoreVersion(id: number, versionId: number): Promise<IAdminSurveyDetail> {
    const res = await fetch(`${BASE}/surveys/${id}/versions/${versionId}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...csrfHeaders(),
        },
    });
    return asJson<IAdminSurveyDetail>(res);
}

export async function publishPresence(
    id: number,
    state: 'editing' | 'idle' | 'left',
): Promise<{ published: boolean; userId: number | null }> {
    const res = await fetch(`${BASE}/surveys/${id}/presence`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify({ state }),
    });
    return asJson<{ published: boolean; userId: number | null }>(res);
}

export async function fetchLicenseKey(): Promise<{ licenseKey: string | null; configured: boolean }> {
    const res = await fetch(`${BASE}/license-key`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<{ licenseKey: string | null; configured: boolean }>(res);
}

export async function updateSurvey(
    id: number,
    body: { name?: string; themeCode?: string | null; archived?: boolean },
): Promise<IAdminSurveySummary> {
    const res = await fetch(`${BASE}/surveys/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(body),
    });
    return asJson<IAdminSurveySummary>(res);
}

export async function deleteSurvey(id: number): Promise<{ deleted: boolean }> {
    const res = await fetch(`${BASE}/surveys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', ...csrfHeaders() },
    });
    return asJson<{ deleted: boolean }>(res);
}

/**
 * Copies a survey's current definition into a new survey, as an unpublished
 * draft, so the copy is reviewed before anyone can answer it.
 */
export async function duplicateSurvey(source: IAdminSurveyDetail): Promise<IAdminSurveySummary> {
    return createSurvey({ name: `${source.name} (copy)`, definition: source.definition ?? { pages: [] } });
}

/** One response: a row of the survey's data table. */
export interface ISurveyResponseSummary {
    id: number;
    responseId: string;
    surveyId: string;
    revision: number | null;
    userId: number | null;
    userName: string | null;
    lastSavedAt: string | null;
    finished: boolean;
    pageNo: number;
    language: string | null;
}

export async function fetchDashboard(surveyId: number): Promise<{
    id: number;
    surveyId: string;
    completedResponses: number;
    totalResponses: number;
    currentVersionRevision: number | null;
}> {
    const res = await fetch(`${BASE}/surveys/${surveyId}/dashboard`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

export interface IDashboardResults {
    surveyId: string;
    definition: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
}

export async function fetchDashboardResults(
    surveyId: number,
    params: { limit?: number } = {},
): Promise<IDashboardResults> {
    const search = new URLSearchParams();
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await fetch(`${BASE}/surveys/${surveyId}/dashboard/results${qs}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IDashboardResults>(res);
}

export async function fetchResponseDetail(
    surveyId: number,
    responseId: number | string,
): Promise<ISurveyResponseSummary & { answers: Record<string, unknown> }> {
    const res = await fetch(`${BASE}/surveys/${surveyId}/responses/${responseId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

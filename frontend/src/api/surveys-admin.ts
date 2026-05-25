/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Admin Surveys API client.
 *
 * Used by the Survey Designer / Responses / Dashboard pages mounted
 * under `/admin/plugins-host/sh2-shp-survey-js/*`. The host's
 * `permissionAwareApiClient` (frontend) handles auth headers and
 * permission metadata; we wrap its calls here so the pages stay free
 * of HTTP boilerplate.
 */

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
    responseCount: number;
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

const BASE = '/api/admin/plugins/sh2-shp-survey-js';

function csrfHeaders(): Record<string, string> {
    if (typeof document === 'undefined') {
        return {};
    }
    const token = document.cookie
        .split('; ')
        .find((part) => part.startsWith('sh_csrf='))
        ?.slice('sh_csrf='.length);
    return token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {};
}

async function asJson<T>(res: Response): Promise<T> {
    const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
    if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    if (body.data === undefined) {
        throw new Error('Response missing data envelope.');
    }
    return body.data;
}

export async function listSurveys(): Promise<IAdminSurveySummary[]> {
    const res = await fetch(`${BASE}/surveys`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson<IAdminSurveySummary[]>(res);
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
): Promise<{ published: boolean }> {
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
    return asJson<{ published: boolean }>(res);
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
 * Duplicate a survey by creating a fresh `surveys` row with a new
 * generated survey id and copying the source's current definition into it as the
 * first published revision. Composed client-side because the host
 * admin API does not (yet) expose a `/duplicate` endpoint; collapsing
 * it here keeps the call site free of orchestration noise.
 */
export async function duplicateSurvey(source: IAdminSurveyDetail): Promise<IAdminSurveySummary> {
    const newName = `${source.name} (copy)`;
    const definition = source.definition ?? { pages: [] };
    const created = await createSurvey({ name: newName, definition });
    if (Object.keys(definition).length > 0) {
        await publishVersion(created.id, { definition, force: true });
    }
    return created;
}

export async function fetchResponses(
    surveyId: number,
    params: { page?: number; limit?: number } = {},
): Promise<{
    items: Array<{
        id: number;
        responseId: string;
        surveyId: string;
        revision: number;
        userId: number | null;
        startedAt: string;
        completedAt: string | null;
        status: string;
    }>;
    page: number;
    limit: number;
    total: number;
}> {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString() ? `?${search.toString()}` : '';
    const res = await fetch(`${BASE}/surveys/${surveyId}/responses${qs}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

export async function fetchDashboard(surveyId: number): Promise<{
    id: number;
    surveyId: string;
    completedResponses: number;
    currentVersionRevision: number | null;
    recent: Array<{ id: number; responseId: string; startedAt: string; status: string }>;
}> {
    const res = await fetch(`${BASE}/surveys/${surveyId}/dashboard`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

export async function fetchResponseDetail(
    surveyId: number,
    responseId: number | string,
): Promise<{
    id: number;
    responseId: string;
    surveyId: string;
    revision: number;
    userId: number | null;
    startedAt: string;
    completedAt: string | null;
    status: string;
    answers: Array<{
        questionName: string;
        questionType: string;
        value: string;
        sanitizedHtml: boolean;
    }>;
}> {
    const res = await fetch(`${BASE}/surveys/${surveyId}/responses/${responseId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

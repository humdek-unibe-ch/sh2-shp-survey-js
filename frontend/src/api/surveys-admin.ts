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
    name: string;
    keySlug: string;
    themeCode: string | null;
    archived: boolean;
    updatedAt: string;
    currentRevision: number | null;
}

export interface IAdminSurveyDetail extends IAdminSurveySummary {
    definition: Record<string, unknown> | null;
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
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { data: T };
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
    keySlug: string;
    definition: Record<string, unknown>;
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
    definition: Record<string, unknown>,
): Promise<{ surveyId: number; revision: number; createdAt: string }> {
    const res = await fetch(`${BASE}/surveys/${id}/versions`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify({ definition }),
    });
    return asJson<{ surveyId: number; revision: number; createdAt: string }>(res);
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
 * Duplicate a survey by creating a fresh `surveys` row with a unique
 * `key_slug` and copying the source's current definition into it as the
 * first published revision. Composed client-side because the host
 * admin API does not (yet) expose a `/duplicate` endpoint; collapsing
 * it here keeps the call site free of orchestration noise.
 */
export async function duplicateSurvey(source: IAdminSurveyDetail): Promise<IAdminSurveySummary> {
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12);
    const newKey = `${source.keySlug}-copy-${stamp}`;
    const newName = `${source.name} (copy)`;
    const definition = source.definition ?? { pages: [] };
    const created = await createSurvey({ name: newName, keySlug: newKey, definition });
    if (Object.keys(definition).length > 0) {
        await publishVersion(created.id, definition);
    }
    return created;
}

export async function fetchResponses(
    surveyId: number,
    params: { page?: number; limit?: number } = {},
): Promise<{
    items: Array<{
        id: number;
        surveyId: number;
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
    surveyId: number;
    completedResponses: number;
    currentVersionRevision: number | null;
    recent: Array<{ id: number; startedAt: string; status: string }>;
}> {
    const res = await fetch(`${BASE}/surveys/${surveyId}/dashboard`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    return asJson(res);
}

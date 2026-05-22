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

const BASE = '/cms-api/v1/admin/plugins/surveyjs';

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

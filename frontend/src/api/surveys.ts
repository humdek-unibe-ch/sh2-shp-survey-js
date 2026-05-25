/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS plugin API client.
 *
 * Wraps every route in `SurveyJsApiRouteSubscriber::onApiRouteRegistry`
 * that the public runtime needs: survey hydration, draft autosave,
 * submission, edit-mode rehydration, file pipeline + dynamic choices.
 *
 * The client is intentionally framework-agnostic (plain fetch) so it
 * is easy to call from the runtime style component, custom-question
 * widgets, and unit tests.
 */

export interface IRuntimeConfig {
    restartOnRefresh: boolean;
    autoSaveIntervalSeconds: number;
    timeoutMinutes: number;
    savePdf: boolean;
    closeModalAtEnd: boolean;
    redirectAtEnd: string | null;
    urlParams: boolean;
    startTime: string | null;
    endTime: string | null;
    oncePerUser: boolean;
    oncePerSchedule: boolean;
    ownEntriesOnly: boolean;
    allowAnonymous: boolean;
    labelSurveyDone: string | null;
    labelSurveyNotActive: string | null;
}

export interface IPublishedRuntimeState {
    isAuthenticated: boolean;
    visitorId: string | null;
    lockoutReason: { reason: string; responseId: string; submittedAt: string | null } | null;
    draft: { responseId: string; pageNo: number; lastSavedAt: string } | null;
    completedResponseId: string | null;
}

export interface IPublishedSurvey {
    surveyId: string;
    name: string;
    themeCode: string | null;
    revision: number;
    definition: Record<string, unknown>;
    extraParams: Record<string, string | number | boolean>;
    tokens: Record<string, string>;
    runtimeConfig: IRuntimeConfig;
    state: IPublishedRuntimeState;
}

export interface ISubmitResult {
    runId: number;
    responseId: string;
    submittedAt: string;
}

export interface IDraftPayload {
    responseId: string;
    pageNo: number;
    payload: Record<string, unknown>;
    lastSavedAt: string;
    expiresAt: string;
}

export interface IUploadedFile {
    id: number;
    responseId: string;
    questionName: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
    downloadUrl: string;
}

export interface IEditResponsePayload {
    responseId: string;
    submittedAt: string | null;
    answers: Record<string, unknown>;
}

export interface ISubmissionEnforcePayload {
    oncePerUser?: boolean;
    oncePerSchedule?: boolean;
    allowAnonymous?: boolean;
    windowStart?: string | null;
    windowEnd?: string | null;
    responseId?: string;
    progress?: Record<string, unknown>;
}

export interface ISubmissionError extends Error {
    status: number;
    reason?: string;
    body?: unknown;
}

const BASE = '/api/plugins/sh2-shp-survey-js';

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

function runtimeConfigHeader(config?: Record<string, unknown>): Record<string, string> {
    if (!config) return {};
    try {
        return { 'X-SurveyJs-Runtime-Config': JSON.stringify(config) };
    } catch {
        return {};
    }
}

async function ensureOk<T>(res: Response): Promise<T> {
    if (!res.ok) {
        let body: unknown = null;
        try {
            body = await res.json();
        } catch {
            // body may not be JSON; leave null
        }
        const reason = (body as { reason?: string } | null)?.reason;
        const err = new Error(`HTTP ${res.status}`) as ISubmissionError;
        err.status = res.status;
        err.reason = reason;
        err.body = body;
        throw err;
    }
    return (await res.json()) as T;
}

export async function fetchPublishedSurvey(
    key: string,
    config?: Record<string, unknown>,
    urlParams?: Record<string, string | number | boolean>,
): Promise<IPublishedSurvey> {
    const url = new URL(`${BASE}/published/${encodeURIComponent(key)}`, window.location.origin);
    if (urlParams) {
        for (const [k, v] of Object.entries(urlParams)) {
            url.searchParams.set(`extraParams[${k}]`, String(v));
        }
    }
    const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...runtimeConfigHeader(config),
        },
    });
    const body = await ensureOk<{ data: IPublishedSurvey }>(res);
    return body.data;
}

export async function submitSurveyAnswers(
    key: string,
    answers: Record<string, unknown>,
    enforce?: ISubmissionEnforcePayload,
): Promise<ISubmitResult> {
    const res = await fetch(`${BASE}/published/${encodeURIComponent(key)}/submit`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify({ answers, enforce: enforce ?? {} }),
    });
    const body = await ensureOk<{ data: ISubmitResult }>(res);
    return body.data;
}

export async function fetchDraft(
    key: string,
    responseId?: string,
): Promise<IDraftPayload | null> {
    const url = new URL(
        `${BASE}/published/${encodeURIComponent(key)}/progress`,
        window.location.origin,
    );
    if (responseId) {
        url.searchParams.set('responseId', responseId);
    }
    const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    const body = await ensureOk<{ data: IDraftPayload | null }>(res);
    return body.data;
}

export async function saveDraft(
    key: string,
    payload: {
        responseId?: string;
        pageNo: number;
        payload: Record<string, unknown>;
    },
): Promise<IDraftPayload> {
    const res = await fetch(`${BASE}/published/${encodeURIComponent(key)}/progress`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const body = await ensureOk<{ data: IDraftPayload }>(res);
    return body.data;
}

export async function deleteDraft(key: string, responseId?: string): Promise<void> {
    const url = new URL(
        `${BASE}/published/${encodeURIComponent(key)}/progress`,
        window.location.origin,
    );
    if (responseId) {
        url.searchParams.set('responseId', responseId);
    }
    const res = await fetch(url.toString(), {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', ...csrfHeaders() },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
}

export async function fetchEditableResponse(
    key: string,
    responseId: string,
): Promise<IEditResponsePayload | null> {
    const url = new URL(
        `${BASE}/published/${encodeURIComponent(key)}/edit`,
        window.location.origin,
    );
    url.searchParams.set('responseId', responseId);
    const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
        return null;
    }
    const body = await ensureOk<{ data: IEditResponsePayload }>(res);
    return body.data;
}

export async function uploadSurveyFile(
    key: string,
    args: { responseId: string; questionName: string; file: File },
): Promise<IUploadedFile> {
    const form = new FormData();
    form.append('responseId', args.responseId);
    form.append('questionName', args.questionName);
    form.append('file', args.file, args.file.name);
    const res = await fetch(`${BASE}/published/${encodeURIComponent(key)}/files`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...csrfHeaders(),
        },
        body: form,
    });
    const body = await ensureOk<{ data: IUploadedFile }>(res);
    return body.data;
}

export async function deleteSurveyFile(key: string, fileId: number): Promise<void> {
    const res = await fetch(
        `${BASE}/published/${encodeURIComponent(key)}/files/${fileId}`,
        {
            method: 'DELETE',
            credentials: 'include',
            headers: { Accept: 'application/json', ...csrfHeaders() },
        },
    );
    if (!res.ok && res.status !== 404) {
        throw new Error(`HTTP ${res.status}`);
    }
}

export async function fetchChoices(
    key: string,
    token: string,
    config?: Record<string, unknown>,
): Promise<Array<{ value: string; text?: string }>> {
    const res = await fetch(
        `${BASE}/published/${encodeURIComponent(key)}/choices/${encodeURIComponent(token)}`,
        {
            credentials: 'include',
            headers: {
                Accept: 'application/json',
                ...runtimeConfigHeader(config),
            },
        },
    );
    const body = await ensureOk<{ data: Array<{ value: string; text?: string }> }>(res);
    return body.data;
}

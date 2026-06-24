/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS plugin API client for the MOBILE host shell.
 *
 * Unlike the frontend client, the mobile renderer does NOT own authenticated
 * network access: every call goes through the native host-services bridge
 * (`IMobileHostServices.request`), which attaches the bearer token, applies
 * `X-Client-Type: mobile`, and performs the single 401-refresh round-trip
 * host-side. The WebView runtime never sees the token — it emits intents and
 * the shell calls these functions in response.
 *
 * Routes/payloads mirror the frontend client (`frontend/src/api/surveys.ts`)
 * exactly, so a mobile submission stores a real `SurveyRun` identically to web
 * (there is no preview/test branch on the backend).
 *
 * Only the runtime routes the renderer needs are wrapped: hydrate
 * (`published`), per-page progress (`progress`), submit (`submit`). The
 * file/choices/edit pipeline stays web-only.
 */

import type { IMobileHostServices } from '@selfhelp/shared/plugin-sdk';

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

export interface ISubmissionEnforcePayload {
    oncePerUser?: boolean;
    oncePerSchedule?: boolean;
    allowAnonymous?: boolean;
    windowStart?: string | null;
    windowEnd?: string | null;
    responseId?: string;
    editMode?: boolean;
    progress?: Record<string, unknown>;
}

/** Error thrown when a host request fails; carries the lifecycle discriminator. */
export class SurveyHostError extends Error {
    readonly status: number;
    readonly reason?: string;
    readonly sessionExpired: boolean;

    constructor(message: string, status: number, reason?: string, sessionExpired = false) {
        super(message);
        this.name = 'SurveyHostError';
        this.status = status;
        this.reason = reason;
        this.sessionExpired = sessionExpired;
    }
}

const PLUGIN_API_PATH = '/cms-api/v1/plugins/sh2-shp-survey-js';

/** Unwrap a host response into the inner API-envelope `data`, throwing on failure. */
function unwrap<T>(res: {
    ok: boolean;
    status: number;
    data: unknown;
    reason?: string;
    error?: string;
    sessionExpired?: boolean;
}): T {
    if (!res.ok) {
        const reason = res.reason ?? extractReason(res.data);
        throw new SurveyHostError(
            res.error ?? `HTTP ${res.status}`,
            res.status,
            reason,
            res.sessionExpired ?? res.status === 401,
        );
    }
    const body = res.data as { data?: T } | null;
    return (body?.data ?? null) as T;
}

function extractReason(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'reason' in body) {
        const reason = (body as { reason?: unknown }).reason;
        if (typeof reason === 'string') return reason;
    }
    return undefined;
}

export async function loadPublishedSurvey(
    host: IMobileHostServices,
    key: string,
    serverConfig?: Record<string, unknown>,
    extraParams?: Record<string, string | number | boolean>,
): Promise<IPublishedSurvey> {
    const query: Record<string, string | number | boolean> = {};
    if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) {
            query[`extraParams[${k}]`] = v;
        }
    }
    const headers: Record<string, string> = {};
    if (serverConfig) {
        try {
            headers['X-SurveyJs-Runtime-Config'] = JSON.stringify(serverConfig);
        } catch {
            /* non-serialisable config — send without the echo header */
        }
    }
    const res = await host.request<{ data: IPublishedSurvey }>({
        path: `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}`,
        method: 'GET',
        headers,
        query,
    });
    return unwrap<IPublishedSurvey>(res);
}

export async function fetchDraft(
    host: IMobileHostServices,
    key: string,
    responseId?: string,
): Promise<IDraftPayload | null> {
    const query: Record<string, string | number | boolean> = {};
    if (responseId) query.responseId = responseId;
    const res = await host.request<{ data: IDraftPayload | null }>({
        path: `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/progress`,
        method: 'GET',
        query,
    });
    return unwrap<IDraftPayload | null>(res);
}

export async function saveProgress(
    host: IMobileHostServices,
    key: string,
    payload: { responseId?: string; pageNo: number; payload: Record<string, unknown> },
): Promise<IDraftPayload> {
    const res = await host.request<{ data: IDraftPayload }>({
        path: `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/progress`,
        method: 'PUT',
        body: payload,
    });
    return unwrap<IDraftPayload>(res);
}

export async function submitSurvey(
    host: IMobileHostServices,
    key: string,
    answers: Record<string, unknown>,
    enforce?: ISubmissionEnforcePayload,
): Promise<ISubmitResult> {
    const res = await host.request<{ data: ISubmitResult }>({
        path: `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/submit`,
        method: 'POST',
        body: { answers, enforce: enforce ?? {} },
    });
    return unwrap<ISubmitResult>(res);
}

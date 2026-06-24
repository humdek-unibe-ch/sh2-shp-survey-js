/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS plugin API client for the MOBILE runtime.
 *
 * Mirrors the frontend client (`frontend/src/api/surveys.ts`) — same
 * routes, same payload shapes, same response envelope — but adapted for
 * the mobile app:
 *
 *   - The mobile app talks to `/cms-api/v1/...` directly (no Next.js BFF
 *     proxy), so there is NO CSRF token to attach (the Symfony backend
 *     disables CSRF for the API). Auth, when present, rides on the
 *     `Authorization: Bearer` header the host injects globally.
 *   - The base URL is resolved at call time: the `selfhelp-mobile-preview`
 *     image serves the app under `<origin>/mobile-preview` and reverse-
 *     proxies `<origin>/mobile-preview/api/cms-api/...` to the private
 *     backend, so requests must carry that prefix. The host may also
 *     publish the resolved base on `globalThis.__SELFHELP_API_BASE__`.
 *
 * Only the public runtime routes the mobile renderer needs are wrapped:
 * hydrate (`published`), per-page progress save (`progress`), and
 * submission (`submit`). The file/choices/edit pipeline stays web-only.
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

export interface ISubmissionError extends Error {
    status: number;
    reason?: string;
    body?: unknown;
}

const PLUGIN_API_PATH = '/cms-api/v1/plugins/sh2-shp-survey-js';

/**
 * Resolve the absolute (or root-relative) API base the mobile runtime
 * should call.
 *
 * Priority:
 *   1. `globalThis.__SELFHELP_API_BASE__` — when the host publishes the
 *      resolved server URL (native app + preview both can set this).
 *   2. Web-preview heuristic — the app is served at `<origin>/<seg>/…`
 *      and the proxy lives at `<origin>/<seg>/api`, so derive that.
 *   3. Same-origin root (`<origin>`) as a last resort.
 *   4. Empty string for non-browser contexts (caller builds a relative URL).
 */
export function resolveApiBase(): string {
    const injected = (globalThis as { __SELFHELP_API_BASE__?: unknown }).__SELFHELP_API_BASE__;
    if (typeof injected === 'string' && injected.trim() !== '') {
        return injected.replace(/\/+$/, '');
    }
    // Read `location` off `globalThis` (the mobile tsconfig has no DOM lib);
    // it is only present on the web export (react-native-web).
    const location = (globalThis as { location?: { origin?: string; pathname?: string } }).location;
    if (location && typeof location.origin === 'string') {
        const origin = location.origin;
        const firstSegment = (location.pathname ?? '/')
            .split('/')
            .filter((part) => part !== '')[0];
        if (firstSegment) {
            return `${origin}/${firstSegment}/api`;
        }
        return origin;
    }
    return '';
}

function buildUrl(base: string, path: string): string {
    return `${base}${path}`;
}

function authHeader(): Record<string, string> {
    const token = (globalThis as { __SELFHELP_ACCESS_TOKEN__?: unknown }).__SELFHELP_ACCESS_TOKEN__;
    if (typeof token === 'string' && token.trim() !== '') {
        return { Authorization: `Bearer ${token}` };
    }
    return {};
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
    const base = resolveApiBase();
    let path = `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}`;
    if (urlParams && Object.keys(urlParams).length > 0) {
        // Built manually (no DOM `URLSearchParams` in the mobile tsconfig lib);
        // mirrors the frontend's `extraParams[<k>]=<v>` shape that the backend
        // reads via `$request->query->all('extraParams')`.
        const search = Object.entries(urlParams)
            .map(([k, v]) => `${encodeURIComponent(`extraParams[${k}]`)}=${encodeURIComponent(String(v))}`)
            .join('&');
        path = `${path}?${search}`;
    }
    const res = await fetch(buildUrl(base, path), {
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...authHeader(),
            ...runtimeConfigHeader(config),
        },
    });
    const body = await ensureOk<{ data: IPublishedSurvey }>(res);
    return body.data;
}

export async function fetchDraft(key: string, responseId?: string): Promise<IDraftPayload | null> {
    const base = resolveApiBase();
    let path = `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/progress`;
    if (responseId) {
        path = `${path}?responseId=${encodeURIComponent(responseId)}`;
    }
    const res = await fetch(buildUrl(base, path), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...authHeader() },
    });
    const body = await ensureOk<{ data: IDraftPayload | null }>(res);
    return body.data;
}

export async function saveDraft(
    key: string,
    payload: { responseId?: string; pageNo: number; payload: Record<string, unknown> },
): Promise<IDraftPayload> {
    const base = resolveApiBase();
    const path = `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/progress`;
    const res = await fetch(buildUrl(base, path), {
        method: 'PUT',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...authHeader(),
        },
        body: JSON.stringify(payload),
    });
    const body = await ensureOk<{ data: IDraftPayload }>(res);
    return body.data;
}

export async function deleteDraft(key: string, responseId?: string): Promise<void> {
    const base = resolveApiBase();
    let path = `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/progress`;
    if (responseId) {
        path = `${path}?responseId=${encodeURIComponent(responseId)}`;
    }
    const res = await fetch(buildUrl(base, path), {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', ...authHeader() },
    });
    if (!res.ok && res.status !== 404) {
        throw new Error(`HTTP ${res.status}`);
    }
}

export async function submitSurveyAnswers(
    key: string,
    answers: Record<string, unknown>,
    enforce?: ISubmissionEnforcePayload,
): Promise<ISubmitResult> {
    const base = resolveApiBase();
    const path = `${PLUGIN_API_PATH}/published/${encodeURIComponent(key)}/submit`;
    const res = await fetch(buildUrl(base, path), {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...authHeader(),
        },
        body: JSON.stringify({ answers, enforce: enforce ?? {} }),
    });
    const body = await ensureOk<{ data: ISubmitResult }>(res);
    return body.data;
}

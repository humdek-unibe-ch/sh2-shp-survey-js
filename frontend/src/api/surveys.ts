/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS plugin API client.
 *
 * Wraps every public route declared in `plugin.json#apiRoutes` (the
 * host's `PluginApiRouteSynchronizer` persists those rows into
 * `api_routes` at install/update time): survey hydration, progress,
 * submission, edit-mode rehydration and the file pipeline.
 *
 * Every call names the page and the section it is made for
 * ({@link ISurveySectionRef}, sent as query parameters). The server checks
 * the caller may use that section and reads every setting from it; the
 * client sends no limits of its own (rule 7.7).
 *
 * The client is intentionally framework-agnostic (plain fetch) so it
 * is easy to call from the runtime style component, custom-question
 * widgets, and unit tests.
 */

import { csrfHeaders } from './csrf';
import { guestKeyHeaders } from './guestKey';
import { extractUrlParams } from '../runtime/urlParams';

/** The section a call is made for, as the host tells the plugin style. */
export interface ISurveySectionRef {
    pageId: number;
    sectionId: number;
    languageId: number | null;
    preview: boolean;
    routeParams: Record<string, string>;
}

/** The section's settings, read by the server from the published section. */
export interface IRuntimeConfig {
    restartOnRefresh: boolean;
    autoSaveIntervalSeconds: number;
    timeoutMinutes: number;
    savePdf: boolean;
    closeModalOnSave: boolean;
    redirectAtEnd: string | null;
    urlParams: boolean;
    oncePerUser: boolean;
    oncePerSchedule: boolean;
    /** Each guest gets a private `sid` in the link (`auto_session_key`). */
    autoSessionKey: boolean;
    /** The response row is named by a key in the link (`update_based_on` or `auto_session_key`). */
    keyedRows: boolean;
    labelSurveyDone: string | null;
    labelSurveyNotActive: string | null;
}

export interface IPublishedRuntimeState {
    isAuthenticated: boolean;
    /** Who is answering: `user:<id>` or `guest`; owns the answers kept in this browser. */
    viewer: string;
    /** Outside the section's daily window, in the participant's timezone. */
    notActive: boolean;
    lockoutReason: { reason: string; responseId: string; submittedAt: string | null } | null;
    draft: { responseId: string; pageNo: number; lastSavedAt: string | null } | null;
    completedResponseId: string | null;
}

export interface IPublishedSurvey {
    surveyId: string;
    name: string;
    themeCode: string | null;
    revision: number;
    /** The published definition with the section's `{{variables}}` filled in. */
    definition: Record<string, unknown>;
    extraParams: Record<string, string | number | boolean>;
    runtimeConfig: IRuntimeConfig;
    state: IPublishedRuntimeState;
}

export interface ISubmitResult {
    recordId: number;
    responseId: string;
    submittedAt: string;
}

export interface IDraftPayload {
    responseId: string;
    pageNo: number;
    /** `data`: the answers so far; `locale`: the language they were given in. */
    payload: Record<string, unknown>;
    lastSavedAt: string | null;
}

/** An upload, stored by the core as a form file of the response; `key` names it in the answer. */
export interface IUploadedFile {
    key: string;
    filename: string;
    mimeType: string;
    downloadUrl: string;
}

export interface IEditResponsePayload {
    responseId: string;
    submittedAt: string | null;
    answers: Record<string, unknown>;
}

/** What the client says about a submit: which response, and where the participant stands. */
export interface ISubmissionPayload {
    responseId?: string;
    /** Update the participant's submitted response `responseId` in place (`?record_id=…`). */
    editMode?: boolean;
    progress?: Record<string, unknown>;
}

export interface ISubmissionError extends Error {
    status: number;
    reason?: string;
    body?: unknown;
}

// Browser-side public-runtime calls go through the host's Next.js
// BFF proxy (`src/app/api/[...path]/route.ts`). The proxy validates
// CSRF, attaches the httpOnly JWT and forwards to Symfony with the
// `/cms-api/v1` prefix prepended. Keep paths after `/api/` in sync with
// the public entries in `plugin.json#apiRoutes`.
const BASE = '/api/plugins/sh2-shp-survey-js';
export const RUNTIME_LICENSE_HEADER = 'X-SurveyJs-License-Key';

function sectionUrl(path: string, ref: ISurveySectionRef, extra: Record<string, string> = {}): string {
    const url = new URL(`${BASE}${path}`, window.location.origin);
    url.searchParams.set('page_id', String(ref.pageId));
    url.searchParams.set('section_id', String(ref.sectionId));
    if (ref.languageId !== null) url.searchParams.set('language_id', String(ref.languageId));
    if (ref.preview) url.searchParams.set('preview', '1');
    for (const [name, value] of Object.entries(ref.routeParams)) {
        url.searchParams.set(`route[${name}]`, value);
    }
    // The page's URL parameters, for `url_params` and the row key of
    // `update_based_on` / `auto_session_key`; the server decides what it uses.
    for (const [name, value] of Object.entries(extractUrlParams())) {
        url.searchParams.set(`extraParams[${name}]`, value);
    }
    for (const [name, value] of Object.entries(extra)) {
        url.searchParams.set(name, value);
    }
    return url.toString();
}

function surveyPath(key: string, rest = ''): string {
    return `/published/${encodeURIComponent(key)}${rest}`;
}

async function ensureOk<T>(res: Response): Promise<T> {
    if (!res.ok) {
        let body: unknown = null;
        try {
            body = await res.json();
        } catch {
            // body may not be JSON; leave null
        }
        // The SelfHelp envelope carries a refusal's reason as `data.reason`.
        const envelope = body as { reason?: string; data?: { reason?: string } | null } | null;
        const reason = envelope?.data?.reason ?? envelope?.reason;
        const err = new Error(`HTTP ${res.status}`) as ISubmissionError;
        err.status = res.status;
        err.reason = reason;
        err.body = body;
        throw err;
    }
    return (await res.json()) as T;
}

export async function fetchPublishedSurvey(key: string, ref: ISurveySectionRef): Promise<IPublishedSurvey> {
    const res = await fetch(sectionUrl(surveyPath(key), ref), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...guestKeyHeaders() },
    });
    const runtimeLicenseKey = res.headers.get(RUNTIME_LICENSE_HEADER);
    if (typeof window !== 'undefined') {
        const runtimeWindow = window as Window & { __SURVEYJS_LICENSE_KEY?: string };
        if (typeof runtimeLicenseKey === 'string' && runtimeLicenseKey !== '') {
            runtimeWindow.__SURVEYJS_LICENSE_KEY = runtimeLicenseKey;
        } else {
            delete runtimeWindow.__SURVEYJS_LICENSE_KEY;
        }
    }
    const body = await ensureOk<{ data: IPublishedSurvey }>(res);
    return body.data;
}

export async function submitSurveyAnswers(
    key: string,
    ref: ISurveySectionRef,
    answers: Record<string, unknown>,
    submission: ISubmissionPayload = {},
): Promise<ISubmitResult> {
    const res = await fetch(sectionUrl(surveyPath(key, '/submit'), ref), {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...guestKeyHeaders(),
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify({ answers, enforce: submission }),
    });
    const body = await ensureOk<{ data: ISubmitResult }>(res);
    return body.data;
}

export async function fetchDraft(
    key: string,
    ref: ISurveySectionRef,
    responseId?: string,
): Promise<IDraftPayload | null> {
    const res = await fetch(sectionUrl(surveyPath(key, '/progress'), ref, responseId ? { responseId } : {}), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...guestKeyHeaders() },
    });
    const body = await ensureOk<{ data: IDraftPayload | null }>(res);
    return body.data;
}

export async function saveDraft(
    key: string,
    ref: ISurveySectionRef,
    payload: {
        responseId?: string;
        pageNo: number;
        payload: Record<string, unknown>;
    },
): Promise<IDraftPayload> {
    const res = await fetch(sectionUrl(surveyPath(key, '/progress'), ref), {
        method: 'PUT',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...guestKeyHeaders(),
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: JSON.stringify(payload),
    });
    const body = await ensureOk<{ data: IDraftPayload }>(res);
    return body.data;
}

export async function deleteDraft(key: string, ref: ISurveySectionRef, responseId?: string): Promise<void> {
    const res = await fetch(sectionUrl(surveyPath(key, '/progress'), ref, responseId ? { responseId } : {}), {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', ...guestKeyHeaders(), ...csrfHeaders() },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
}

export async function fetchEditableResponse(
    key: string,
    ref: ISurveySectionRef,
    responseId: string,
): Promise<IEditResponsePayload | null> {
    const res = await fetch(sectionUrl(surveyPath(key, '/edit'), ref, { responseId }), {
        credentials: 'include',
        headers: { Accept: 'application/json', ...guestKeyHeaders() },
    });
    if (res.status === 404) {
        return null;
    }
    const body = await ensureOk<{ data: IEditResponsePayload }>(res);
    return body.data;
}

export async function uploadSurveyFile(
    key: string,
    ref: ISurveySectionRef,
    args: { responseId: string; questionName: string; file: File },
): Promise<IUploadedFile> {
    const form = new FormData();
    form.append('responseId', args.responseId);
    form.append('questionName', args.questionName);
    form.append('file', args.file, args.file.name);
    const res = await fetch(sectionUrl(surveyPath(key, '/files'), ref), {
        method: 'POST',
        credentials: 'include',
        headers: {
            Accept: 'application/json',
            ...guestKeyHeaders(),
            ...csrfHeaders(),
        },
        body: form,
    });
    const body = await ensureOk<{ data: IUploadedFile }>(res);
    return body.data;
}


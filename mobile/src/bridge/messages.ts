/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Typed postMessage contract between the isolated SurveyJS WebView runtime
 * and the native RN shell (host).
 *
 * Security model (enforced by both sides):
 *   - Every message carries `source: 'sh2-surveyjs'` and a known `type`.
 *   - The receiver runs the matching type guard and DROPS anything that does
 *     not match the expected shape (no `eval`, no trusting arbitrary data).
 *   - The WebView NEVER receives the access token and NEVER performs a
 *     backend call: it emits *intents* (`LOAD_SURVEY` / `SAVE_PROGRESS` /
 *     `SUBMIT_SURVEY`) and consumes *results* the native host returns after
 *     performing the authenticated request via the host-services bridge.
 *
 * This module is framework-free so it can be imported by the WebView runtime
 * bundle, the RN shell, and the contract tests alike.
 */

import type {
    IPublishedRuntimeState,
    IRuntimeConfig,
    ISubmissionEnforcePayload,
} from '../api/surveys';
import type { IRuntimeSectionConfig } from '../styles/section';

/** Protocol tag stamped on every message in both directions. */
export const BRIDGE_SOURCE = 'sh2-surveyjs' as const;

/** Bumped when the message contract changes in a breaking way. */
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

/* ------------------------------------------------------------------ *
 * WebView -> Host (intents + UI signals)
 * ------------------------------------------------------------------ */

export type TWebviewToHostType =
    | 'READY'
    | 'LOAD_SURVEY'
    | 'SAVE_PROGRESS'
    | 'SUBMIT_SURVEY'
    | 'RESIZE'
    | 'REQUEST_REDIRECT'
    | 'RUNTIME_ERROR'
    | 'UNSUPPORTED';

interface IBridgeEnvelope<TType extends string> {
    source: typeof BRIDGE_SOURCE;
    type: TType;
}

/** Runtime has booted and is ready to receive `INIT`. */
export interface IReadyMessage extends IBridgeEnvelope<'READY'> {
    protocolVersion: number;
}

/** Runtime asks the host to load the published survey definition. */
export interface ILoadSurveyMessage extends IBridgeEnvelope<'LOAD_SURVEY'> {
    surveyKey: string;
}

/** Runtime asks the host to persist per-page progress (draft). */
export interface ISaveProgressMessage extends IBridgeEnvelope<'SAVE_PROGRESS'> {
    responseId: string;
    pageNo: number;
    data: Record<string, unknown>;
    locale?: string;
}

/** Runtime asks the host to submit the completed survey. */
export interface ISubmitSurveyMessage extends IBridgeEnvelope<'SUBMIT_SURVEY'> {
    responseId: string | null;
    data: Record<string, unknown>;
    enforce: ISubmissionEnforcePayload;
}

/** Runtime reports its measured content height (native sizing). */
export interface IResizeMessage extends IBridgeEnvelope<'RESIZE'> {
    height: number;
}

/** Runtime asks the host to redirect after completion. */
export interface IRequestRedirectMessage extends IBridgeEnvelope<'REQUEST_REDIRECT'> {
    target: string;
    external: boolean;
}

/** Runtime reports an unrecoverable runtime error. */
export interface IRuntimeErrorMessage extends IBridgeEnvelope<'RUNTIME_ERROR'> {
    message: string;
}

/** Runtime reports an unsupported feature (degrades in place, never crashes). */
export interface IUnsupportedMessage extends IBridgeEnvelope<'UNSUPPORTED'> {
    feature: string;
}

export type TWebviewToHostMessage =
    | IReadyMessage
    | ILoadSurveyMessage
    | ISaveProgressMessage
    | ISubmitSurveyMessage
    | IResizeMessage
    | IRequestRedirectMessage
    | IRuntimeErrorMessage
    | IUnsupportedMessage;

/* ------------------------------------------------------------------ *
 * Host -> WebView (results + inputs; never a raw token)
 * ------------------------------------------------------------------ */

export type THostToWebviewType =
    | 'INIT'
    | 'SURVEY_LOADED'
    | 'PROGRESS_SAVED'
    | 'SUBMIT_RESULT'
    | 'SESSION_EXPIRED'
    | 'SET_LOCALE';

/** Host bootstraps the runtime (config + display inputs, no token). */
export interface IInitMessage extends IBridgeEnvelope<'INIT'> {
    surveyKey: string;
    config: IRuntimeSectionConfig;
    theme: string | null;
    locale: string | null;
}

/** Host returns the loaded survey definition + server state + draft. */
export interface ISurveyLoadedMessage extends IBridgeEnvelope<'SURVEY_LOADED'> {
    definition: Record<string, unknown>;
    tokens: Record<string, string>;
    extraParams: Record<string, string | number | boolean>;
    runtimeConfig: IRuntimeConfig;
    state: IPublishedRuntimeState;
    draft: { responseId: string; pageNo: number; data: Record<string, unknown> } | null;
}

/** Host confirms a progress save. */
export interface IProgressSavedMessage extends IBridgeEnvelope<'PROGRESS_SAVED'> {
    ok: boolean;
    responseId?: string;
}

/** Host returns the submission outcome. */
export type ISubmitResultMessage = IBridgeEnvelope<'SUBMIT_RESULT'> &
    (
        | { ok: true; responseId: string; submittedAt: string }
        | { ok: false; reason?: string; message: string }
    );

/** Host signals the session could not be refreshed (auth expired). */
export type ISessionExpiredMessage = IBridgeEnvelope<'SESSION_EXPIRED'>;

/** Host pushes a locale change to the runtime. */
export interface ISetLocaleMessage extends IBridgeEnvelope<'SET_LOCALE'> {
    locale: string;
}

export type THostToWebviewMessage =
    | IInitMessage
    | ISurveyLoadedMessage
    | IProgressSavedMessage
    | ISubmitResultMessage
    | ISessionExpiredMessage
    | ISetLocaleMessage;

/* ------------------------------------------------------------------ *
 * Guards — every receiver validates the shape before acting.
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasBridgeEnvelope(value: unknown): value is { source: string; type: string } {
    return (
        isRecord(value) &&
        value.source === BRIDGE_SOURCE &&
        typeof value.type === 'string'
    );
}

const WEBVIEW_TO_HOST_TYPES: ReadonlySet<string> = new Set<TWebviewToHostType>([
    'READY',
    'LOAD_SURVEY',
    'SAVE_PROGRESS',
    'SUBMIT_SURVEY',
    'RESIZE',
    'REQUEST_REDIRECT',
    'RUNTIME_ERROR',
    'UNSUPPORTED',
]);

const HOST_TO_WEBVIEW_TYPES: ReadonlySet<string> = new Set<THostToWebviewType>([
    'INIT',
    'SURVEY_LOADED',
    'PROGRESS_SAVED',
    'SUBMIT_RESULT',
    'SESSION_EXPIRED',
    'SET_LOCALE',
]);

/**
 * Validate a message coming FROM the WebView (the native host calls this).
 * Performs per-type field checks so a malformed/hostile message is dropped.
 */
export function isWebviewToHostMessage(value: unknown): value is TWebviewToHostMessage {
    if (!hasBridgeEnvelope(value) || !WEBVIEW_TO_HOST_TYPES.has(value.type)) return false;
    const msg = value as Record<string, unknown>;
    switch (msg.type) {
        case 'READY':
            return true;
        case 'LOAD_SURVEY':
            return typeof msg.surveyKey === 'string' && msg.surveyKey !== '';
        case 'SAVE_PROGRESS':
            return (
                typeof msg.responseId === 'string' &&
                typeof msg.pageNo === 'number' &&
                isRecord(msg.data)
            );
        case 'SUBMIT_SURVEY':
            return (
                (msg.responseId === null || typeof msg.responseId === 'string') &&
                isRecord(msg.data) &&
                isRecord(msg.enforce)
            );
        case 'RESIZE':
            return typeof msg.height === 'number' && Number.isFinite(msg.height);
        case 'REQUEST_REDIRECT':
            return typeof msg.target === 'string' && typeof msg.external === 'boolean';
        case 'RUNTIME_ERROR':
            return typeof msg.message === 'string';
        case 'UNSUPPORTED':
            return typeof msg.feature === 'string';
        default:
            return false;
    }
}

/**
 * Validate a message coming FROM the host (the WebView runtime calls this).
 */
export function isHostToWebviewMessage(value: unknown): value is THostToWebviewMessage {
    if (!hasBridgeEnvelope(value) || !HOST_TO_WEBVIEW_TYPES.has(value.type)) return false;
    const msg = value as Record<string, unknown>;
    switch (msg.type) {
        case 'INIT':
            return typeof msg.surveyKey === 'string' && isRecord(msg.config);
        case 'SURVEY_LOADED':
            return isRecord(msg.definition) && isRecord(msg.state);
        case 'PROGRESS_SAVED':
            return typeof msg.ok === 'boolean';
        case 'SUBMIT_RESULT':
            return typeof msg.ok === 'boolean';
        case 'SESSION_EXPIRED':
            return true;
        case 'SET_LOCALE':
            return typeof msg.locale === 'string';
        default:
            return false;
    }
}

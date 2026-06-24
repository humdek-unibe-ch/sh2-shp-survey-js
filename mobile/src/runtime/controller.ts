/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * SurveyJS WebView runtime controller.
 *
 * This is the DOM-free brain of the isolated WebView runtime: given a
 * `survey-core` model and the typed bridge `post`, it owns the survey
 * lifecycle WITHOUT touching the network. It emits intents
 * (`SAVE_PROGRESS` / `SUBMIT_SURVEY` / `REQUEST_REDIRECT`) and reacts to the
 * results the native host returns (`SUBMIT_RESULT` / `SESSION_EXPIRED` /
 * `PROGRESS_SAVED` / `SET_LOCALE`).
 *
 * Keeping it framework- and DOM-free means the unit test drives a REAL
 * `survey-core` model (fill -> validate -> complete) headlessly in Node and
 * asserts the controller emits `SUBMIT_SURVEY` (never a `fetch`).
 */

import type { THostToWebviewMessage, TWebviewToHostMessage } from '../bridge/messages';
import { BRIDGE_SOURCE } from '../bridge/messages';
import type { IRuntimeSectionConfig } from '../styles/section';
import { buildEnforcePayload, newResponseId } from './lifecycle';

export type TRuntimeLifecycle =
    | 'booting'
    | 'loading'
    | 'ready'
    | 'submitting'
    | 'submitted'
    | 'locked'
    | 'session-expired'
    | 'error';

export interface IRuntimeLifecycleDetail {
    message?: string;
    submittedAt?: string;
}

/** The slice of the `survey-core` `Model` the controller depends on. */
export interface ISurveyModelLike {
    data: Record<string, unknown>;
    currentPageNo: number;
    locale: string;
    onCurrentPageChanged: { add(cb: () => void): void };
    onComplete: { add(cb: (sender: ISurveyModelLike) => void): void };
}

export interface IControllerOptions {
    config: IRuntimeSectionConfig;
    post: (msg: TWebviewToHostMessage) => void;
    onLifecycle: (lifecycle: TRuntimeLifecycle, detail?: IRuntimeLifecycleDetail) => void;
    /** Response id restored from a server draft, if any. */
    initialResponseId?: string | null;
}

export interface ISurveyRuntimeController {
    attachModel(model: ISurveyModelLike): void;
    handleHostMessage(msg: THostToWebviewMessage): void;
    getResponseId(): string | null;
    getLifecycle(): TRuntimeLifecycle;
}

/** True for an absolute URL with a scheme (`https://`, `mailto:`-style schemes). */
export function isExternalRedirect(target: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

export function createSurveyRuntimeController(options: IControllerOptions): ISurveyRuntimeController {
    const { config, post, onLifecycle } = options;
    let responseId: string | null = options.initialResponseId ?? null;
    let lifecycle: TRuntimeLifecycle = 'booting';
    let model: ISurveyModelLike | null = null;

    function setLifecycle(next: TRuntimeLifecycle, detail?: IRuntimeLifecycleDetail): void {
        lifecycle = next;
        onLifecycle(next, detail);
    }

    function ensureResponseId(): string {
        if (responseId === null) responseId = newResponseId();
        return responseId;
    }

    function attachModel(nextModel: ISurveyModelLike): void {
        model = nextModel;

        nextModel.onCurrentPageChanged.add(() => {
            post({
                source: BRIDGE_SOURCE,
                type: 'SAVE_PROGRESS',
                responseId: ensureResponseId(),
                pageNo: nextModel.currentPageNo,
                data: nextModel.data,
                locale: nextModel.locale,
            });
        });

        nextModel.onComplete.add((sender) => {
            setLifecycle('submitting');
            const enforce = buildEnforcePayload(config, responseId, sender.currentPageNo);
            post({
                source: BRIDGE_SOURCE,
                type: 'SUBMIT_SURVEY',
                responseId,
                data: sender.data,
                enforce,
            });
        });

        setLifecycle('ready');
    }

    function handleSubmitResult(msg: Extract<THostToWebviewMessage, { type: 'SUBMIT_RESULT' }>): void {
        if (msg.ok) {
            responseId = msg.responseId;
            if (config.oncePerUser || config.oncePerSchedule) {
                setLifecycle('locked');
            } else {
                setLifecycle('submitted', { submittedAt: msg.submittedAt });
            }
            if (config.redirectAtEnd) {
                post({
                    source: BRIDGE_SOURCE,
                    type: 'REQUEST_REDIRECT',
                    target: config.redirectAtEnd,
                    external: isExternalRedirect(config.redirectAtEnd),
                });
            }
            return;
        }
        if (msg.reason === 'already_submitted_once' || msg.reason === 'already_submitted_in_window') {
            setLifecycle('locked');
            return;
        }
        setLifecycle('error', { message: msg.message });
    }

    function handleHostMessage(msg: THostToWebviewMessage): void {
        switch (msg.type) {
            case 'SUBMIT_RESULT':
                handleSubmitResult(msg);
                return;
            case 'SESSION_EXPIRED':
                setLifecycle('session-expired');
                return;
            case 'PROGRESS_SAVED':
                if (msg.responseId) responseId = msg.responseId;
                return;
            case 'SET_LOCALE':
                if (model) model.locale = msg.locale;
                return;
            default:
                // INIT / SURVEY_LOADED are consumed by the React app (it builds
                // the model); the controller ignores them.
                return;
        }
    }

    return {
        attachModel,
        handleHostMessage,
        getResponseId: () => responseId,
        getLifecycle: () => lifecycle,
    };
}

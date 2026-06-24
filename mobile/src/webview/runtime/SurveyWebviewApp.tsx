/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Isolated SurveyJS WebView runtime (browser side).
 *
 * Renders the OFFICIAL SurveyJS React UI (`survey-react-ui` + `survey-core`)
 * — the same library the web frontend uses — so mobile gets full parity
 * (same JSON, question types, validation, conditional logic, completion).
 * It owns the UI lifecycle but NOT the network: it emits typed intents over
 * the bridge and the native host performs every authenticated call and
 * returns the result.
 *
 * Built ONLY by the WebView Vite bundle (`vite.webview.config.ts`) into a
 * single self-contained HTML (survey-core + survey-react-ui JS/CSS inlined,
 * no CDN). Excluded from the package `tsc`.
 */

import { useEffect, useRef, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';

import { BRIDGE_SOURCE, BRIDGE_PROTOCOL_VERSION } from '../../bridge/messages';
import type { THostToWebviewMessage } from '../../bridge/messages';
import {
    createSurveyRuntimeController,
    type ISurveyRuntimeController,
    type TRuntimeLifecycle,
} from '../../runtime/controller';
import { isOutsideSchedule, stripHtml } from '../../runtime/lifecycle';
import type { IRuntimeSectionConfig } from '../../styles/section';
import { createRuntimeBridge, type IRuntimeBridge } from './bridge';

interface IRuntimeLabels {
    surveyDone: string | null;
    surveyNotActive: string | null;
}

export function SurveyWebviewApp(): React.ReactElement {
    const [lifecycle, setLifecycle] = useState<TRuntimeLifecycle>('booting');
    const [model, setModel] = useState<Model | null>(null);
    const [statusText, setStatusText] = useState<string | null>(null);

    const bridgeRef = useRef<IRuntimeBridge | null>(null);
    const controllerRef = useRef<ISurveyRuntimeController | null>(null);
    const configRef = useRef<IRuntimeSectionConfig | null>(null);
    const localeRef = useRef<string | null>(null);
    const labelsRef = useRef<IRuntimeLabels>({ surveyDone: null, surveyNotActive: null });

    useEffect(() => {
        const bridge = createRuntimeBridge((message) => handleHostMessage(message));
        bridgeRef.current = bridge;
        setLifecycle('loading');
        bridge.post({ source: BRIDGE_SOURCE, type: 'READY', protocolVersion: BRIDGE_PROTOCOL_VERSION });
        return () => bridge.dispose();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Report content height to the native host so it can size the WebView.
    useEffect(() => {
        const report = (): void => {
            const height = document.documentElement.scrollHeight;
            bridgeRef.current?.post({ source: BRIDGE_SOURCE, type: 'RESIZE', height });
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(document.documentElement);
        return () => observer.disconnect();
    }, [lifecycle, model]);

    function handleHostMessage(message: THostToWebviewMessage): void {
        switch (message.type) {
            case 'INIT': {
                configRef.current = message.config;
                localeRef.current = message.locale;
                if (isOutsideSchedule(message.config)) {
                    setStatusText(stripHtml(message.config.labelSurveyNotActive));
                    setLifecycle('locked');
                    return;
                }
                bridgeRef.current?.post({
                    source: BRIDGE_SOURCE,
                    type: 'LOAD_SURVEY',
                    surveyKey: message.surveyKey,
                });
                return;
            }
            case 'SURVEY_LOADED': {
                labelsRef.current = {
                    surveyDone: message.runtimeConfig.labelSurveyDone,
                    surveyNotActive: message.runtimeConfig.labelSurveyNotActive,
                };
                if (message.state.lockoutReason) {
                    setStatusText(stripHtml(message.runtimeConfig.labelSurveyDone));
                    setLifecycle('locked');
                    return;
                }
                buildModel(message);
                return;
            }
            default:
                controllerRef.current?.handleHostMessage(message);
                return;
        }
    }

    function buildModel(message: Extract<THostToWebviewMessage, { type: 'SURVEY_LOADED' }>): void {
        const config = configRef.current;
        if (!config || !bridgeRef.current) return;

        const nextModel = new Model(message.definition);
        const variables = { ...message.tokens, ...message.extraParams };
        for (const [key, value] of Object.entries(variables)) {
            nextModel.setVariable(key, value);
        }
        if (localeRef.current) nextModel.locale = localeRef.current;

        let initialResponseId: string | null = null;
        if (message.draft) {
            nextModel.data = { ...message.draft.data };
            if (Number.isInteger(message.draft.pageNo) && message.draft.pageNo >= 0) {
                nextModel.currentPageNo = message.draft.pageNo;
            }
            initialResponseId = message.draft.responseId;
        }

        const controller = createSurveyRuntimeController({
            config,
            post: bridgeRef.current.post,
            initialResponseId,
            onLifecycle: (next, detail) => {
                if (next === 'locked') setStatusText(stripHtml(labelsRef.current.surveyDone));
                setLifecycle(next);
                if (detail?.message) setStatusText(detail.message);
            },
        });
        controllerRef.current = controller;
        controller.attachModel(nextModel);
        setModel(nextModel);
    }

    if (lifecycle === 'ready' && model) {
        return <Survey model={model} />;
    }

    return <StatusView lifecycle={lifecycle} statusText={statusText} />;
}

function StatusView({
    lifecycle,
    statusText,
}: {
    lifecycle: TRuntimeLifecycle;
    statusText: string | null;
}): React.ReactElement {
    const message = resolveStatusMessage(lifecycle, statusText);
    return (
        <div className="sh2-survey-status" role="status" aria-live="polite">
            {message}
        </div>
    );
}

function resolveStatusMessage(lifecycle: TRuntimeLifecycle, statusText: string | null): string {
    switch (lifecycle) {
        case 'booting':
        case 'loading':
            return 'Loading survey…';
        case 'submitting':
            return 'Submitting your response…';
        case 'submitted':
            return 'Thank you — your response was recorded.';
        case 'locked':
            return statusText ?? 'You have already completed this survey.';
        case 'session-expired':
            return 'Your session has expired. Please reopen this page to continue.';
        case 'error':
            return statusText ?? 'The survey could not be displayed.';
        default:
            return statusText ?? 'Loading survey…';
    }
}

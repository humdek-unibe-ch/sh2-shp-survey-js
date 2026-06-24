/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Interactive SurveyJS runtime for the mobile WEB export.
 *
 * This is the mobile counterpart of the frontend `SurveyRuntime`
 * (`frontend/src/runtime/SurveyRuntime.tsx`) and reuses the SurveyJS
 * React library (`survey-core` + `survey-react-ui`). It targets the
 * Expo **web** export (react-native-web has a DOM, which the SurveyJS
 * React UI requires); on native the dispatcher in `SurveyJsStyle`
 * routes to the read-only viewer instead.
 *
 * Parity with the web runtime (the explicitly requested behaviour):
 *   - fetch `/published/{key}` (definition + tokens + runtimeConfig + state),
 *   - render the survey with `survey-react-ui`,
 *   - hydrate from the server-side draft on mount (unless restartOnRefresh),
 *   - persist per-page progress to `PUT /progress` on page change + on the
 *     `autoSaveIntervalSeconds` timer ("on next page, save the data"),
 *   - submit on `onComplete` via `POST /submit` with the `enforce` payload,
 *   - redirect to `redirect_at_end` after a successful submit,
 *   - surface the locked / not-active / submitted lifecycle states.
 *
 * Web-only extras the frontend ships (Mantine theming, the commercial
 * Save-as-PDF button, GPX/Video/rich-text custom questions) are NOT
 * bundled here; unsupported question types degrade to SurveyJS defaults.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, View } from 'react-native';
import type { SurveyModel } from 'survey-core';

import {
    type IPublishedSurvey,
    type ISubmissionEnforcePayload,
    fetchDraft,
    fetchPublishedSurvey,
    saveDraft,
    submitSurveyAnswers,
} from '../api/surveys';
import {
    type IRuntimeSectionConfig,
    type ISectionLike,
    buildRuntimeConfigFromSection,
    configToServerConfig,
    extractSurveyId,
} from './section';

export interface ISurveyJsRuntimeStyleProps {
    section: ISectionLike;
    values?: Record<string, unknown>;
}

interface ISurveyRuntimeBridge {
    Survey: React.ComponentType<{ model: unknown }>;
    Model: new (definition: unknown) => SurveyModel;
}

type TLifecycle =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'not-active'; label: string | null }
    | { kind: 'locked'; label: string | null }
    | { kind: 'ready' }
    | { kind: 'submitting' }
    | { kind: 'submitted'; submittedAt: string };

async function loadRuntime(): Promise<ISurveyRuntimeBridge> {
    const [core, ui] = await Promise.all([import('survey-core'), import('survey-react-ui')]);
    try {
        // Base SurveyJS styling. Only the web export (Expo Metro) has a CSS
        // loader; the dynamic import is wrapped so a missing loader never
        // breaks the runtime.
        await import('survey-core/survey-core.css');
    } catch {
        /* no CSS loader (non-web) — render with default browser styles */
    }
    return {
        Survey: ui.Survey as unknown as React.ComponentType<{ model: unknown }>,
        Model: core.Model as unknown as new (definition: unknown) => SurveyModel,
    };
}

export function SurveyJsRuntimeStyle({ section }: ISurveyJsRuntimeStyleProps): React.ReactElement | null {
    const surveyIdentifier = useMemo(() => extractSurveyId(section), [section]);
    const config = useMemo(() => buildRuntimeConfigFromSection(section), [section]);

    const [bridge, setBridge] = useState<ISurveyRuntimeBridge | null>(null);
    const [published, setPublished] = useState<IPublishedSurvey | null>(null);
    const [lifecycle, setLifecycle] = useState<TLifecycle>({ kind: 'loading' });
    const [model, setModel] = useState<SurveyModel | null>(null);

    const responseIdRef = useRef<string | null>(null);
    const submittingRef = useRef(false);

    // Step 1: lazy-load the SurveyJS runtime bundle.
    useEffect(() => {
        let cancelled = false;
        loadRuntime()
            .then((b) => {
                if (!cancelled) setBridge(b);
            })
            .catch((err: Error) => {
                if (!cancelled) {
                    setLifecycle({ kind: 'error', message: `SurveyJS runtime failed to load: ${err.message}` });
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Step 2: fetch the published definition + runtimeConfig + state.
    useEffect(() => {
        if (!surveyIdentifier) return;
        let cancelled = false;
        fetchPublishedSurvey(surveyIdentifier, configToServerConfig(config))
            .then((data) => {
                if (cancelled) return;
                setPublished(data);
                if (data.state.lockoutReason) {
                    setLifecycle({ kind: 'locked', label: data.runtimeConfig.labelSurveyDone });
                    return;
                }
                if (isOutsideSchedule(config)) {
                    setLifecycle({ kind: 'not-active', label: data.runtimeConfig.labelSurveyNotActive });
                    return;
                }
                setLifecycle({ kind: 'ready' });
            })
            .catch((err: Error) => {
                if (!cancelled) setLifecycle({ kind: 'error', message: `Survey not available: ${err.message}` });
            });
        return () => {
            cancelled = true;
        };
    }, [surveyIdentifier, config]);

    // Step 3: build the model once bridge + definition arrived and we're ready.
    useEffect(() => {
        if (!bridge || !published || lifecycle.kind !== 'ready') return;
        let disposed = false;

        const nextModel = new bridge.Model(published.definition);

        const tokensAndExtras = { ...published.tokens, ...published.extraParams };
        for (const [key, value] of Object.entries(tokensAndExtras)) {
            nextModel.setVariable(key, value);
        }

        const ensureResponseId = (): string => {
            if (responseIdRef.current === null) {
                responseIdRef.current = `R_${cryptoRandomHex(8)}`;
            }
            return responseIdRef.current;
        };

        const persistProgress = async (survey: SurveyModel, triggerType: string): Promise<void> => {
            const responseId = ensureResponseId();
            try {
                await saveDraft(published.surveyId, {
                    responseId,
                    pageNo: survey.currentPageNo,
                    payload: {
                        data: survey.data,
                        triggerType,
                        locale: survey.locale,
                    },
                });
            } catch {
                // Non-fatal: the next page change / interval retries. In the
                // read-only mobile preview the write proxy blocks this by design.
            }
        };

        // Step 4: hydrate from the server-side draft (cross-device resume).
        void hydrateModel(nextModel, {
            published,
            config,
            assignResponseId: (value) => {
                responseIdRef.current = value;
            },
        });

        // Step 5: per-page + interval progress persistence ("on next page save").
        const autosaveIntervalMs = published.runtimeConfig.autoSaveIntervalSeconds * 1000;
        let autosaveTimer: ReturnType<typeof setInterval> | null = null;
        if (autosaveIntervalMs > 0) {
            autosaveTimer = setInterval(() => {
                void persistProgress(nextModel, 'updated');
            }, autosaveIntervalMs);
        }
        nextModel.onCurrentPageChanged.add(() => {
            void persistProgress(nextModel, 'updated');
        });

        // Step 6: completion → submit → redirect.
        nextModel.onComplete.add((sender: SurveyModel) => {
            submittingRef.current = true;
            setLifecycle({ kind: 'submitting' });
            const enforce = buildEnforcePayload(config, responseIdRef.current, sender.currentPageNo);
            void submitSurveyAnswers(published.surveyId, sender.data, enforce)
                .then((result) => {
                    if (disposed) return;
                    submittingRef.current = false;
                    responseIdRef.current = result.responseId;
                    if (config.oncePerUser || config.oncePerSchedule) {
                        setLifecycle({ kind: 'locked', label: published.runtimeConfig.labelSurveyDone });
                    } else {
                        setLifecycle({ kind: 'submitted', submittedAt: result.submittedAt });
                    }
                    if (config.redirectAtEnd) {
                        redirectTo(config.redirectAtEnd);
                    }
                })
                .catch((err) => {
                    submittingRef.current = false;
                    if (disposed) return;
                    const reason = (err as { reason?: string }).reason ?? '';
                    if (reason === 'already_submitted_once' || reason === 'already_submitted_in_window') {
                        setLifecycle({ kind: 'locked', label: published.runtimeConfig.labelSurveyDone });
                        return;
                    }
                    setLifecycle({ kind: 'error', message: `Survey submission failed: ${(err as Error).message}` });
                });
        });

        setModel(nextModel);
        return () => {
            disposed = true;
            if (autosaveTimer) clearInterval(autosaveTimer);
        };
    }, [bridge, published, config, lifecycle.kind]);

    if (!surveyIdentifier) {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#fab005', borderRadius: 6 }}>
                <Text style={{ color: '#856404' }}>The SurveyJS section is missing a selected survey.</Text>
            </View>
        );
    }

    if (lifecycle.kind === 'error') {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#fa5252', borderRadius: 6 }}>
                <Text style={{ color: '#c92a2a' }}>{lifecycle.message}</Text>
            </View>
        );
    }

    if (lifecycle.kind === 'not-active' || lifecycle.kind === 'locked') {
        const fallback =
            lifecycle.kind === 'locked'
                ? 'You have already completed this survey.'
                : 'This survey is not currently active.';
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#dee2e6', borderRadius: 6 }}>
                <Text style={{ color: '#495057' }}>{stripHtml(lifecycle.label) ?? fallback}</Text>
            </View>
        );
    }

    if (lifecycle.kind === 'submitted') {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#40c057', borderRadius: 6 }}>
                <Text style={{ color: '#2b8a3e', fontWeight: '600' }}>
                    Thank you — your response was recorded.
                </Text>
            </View>
        );
    }

    if (lifecycle.kind === 'loading' || lifecycle.kind === 'submitting' || !bridge || !published || !model) {
        return (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ marginTop: 8, color: '#495057' }}>
                    {lifecycle.kind === 'submitting' ? 'Submitting your response…' : 'Loading survey…'}
                </Text>
            </View>
        );
    }

    const Survey = bridge.Survey;
    return (
        <View style={{ paddingVertical: 8 }}>
            <Survey model={model} />
        </View>
    );
}

interface IHydrateArgs {
    published: IPublishedSurvey;
    config: IRuntimeSectionConfig;
    assignResponseId: (value: string) => void;
}

async function hydrateModel(model: SurveyModel, args: IHydrateArgs): Promise<void> {
    const { published, config, assignResponseId } = args;
    if (config.restartOnRefresh) {
        assignResponseId(`R_${cryptoRandomHex(8)}`);
        return;
    }
    try {
        const draft = await fetchDraft(published.surveyId, published.state.draft?.responseId);
        if (draft) {
            assignResponseId(draft.responseId);
            const data = extractDraftData(draft.payload);
            model.data = { ...data };
            if (Number.isInteger(draft.pageNo) && draft.pageNo >= 0) {
                model.currentPageNo = draft.pageNo;
            }
            return;
        }
    } catch {
        // ignore — fall through to a fresh response id
    }
    assignResponseId(`R_${cryptoRandomHex(8)}`);
}

function extractDraftData(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
    }
    return {};
}

function buildEnforcePayload(
    config: IRuntimeSectionConfig,
    responseId: string | null,
    pageNo: number,
): ISubmissionEnforcePayload {
    const scheduleWindow = config.oncePerSchedule
        ? resolveScheduleWindow(config.startTime, config.endTime)
        : null;
    return {
        oncePerUser: config.oncePerUser,
        oncePerSchedule: config.oncePerSchedule,
        allowAnonymous: config.allowAnonymous,
        windowStart: scheduleWindow?.start ?? null,
        windowEnd: scheduleWindow?.end ?? null,
        responseId: responseId ?? undefined,
        editMode: false,
        progress: { pageNo, triggerType: 'finished' },
    };
}

export function isOutsideSchedule(config: { startTime: string | null; endTime: string | null }): boolean {
    if (!config.startTime || !config.endTime) return false;
    if (config.startTime === '00:00' && config.endTime === '00:00') return false;
    const start = parseClockTime(config.startTime);
    const end = parseClockTime(config.endTime);
    if (start === null || end === null) return false;
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (start <= end) {
        return minutesNow < start || minutesNow > end;
    }
    return minutesNow > end && minutesNow < start;
}

function resolveScheduleWindow(
    startTime: string | null,
    endTime: string | null,
): { start: string; end: string } | null {
    const start = parseClockTimeParts(startTime);
    const end = parseClockTimeParts(endTime);
    if (!start || !end) return null;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(start.hour, start.minute, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setHours(end.hour, end.minute, 0, 0);
    if (windowStart.getTime() > windowEnd.getTime()) {
        if (windowEnd.getTime() > now.getTime()) {
            windowStart.setDate(windowStart.getDate() - 1);
        } else {
            windowEnd.setDate(windowEnd.getDate() + 1);
        }
    }
    return { start: windowStart.toISOString(), end: windowEnd.toISOString() };
}

function parseClockTime(time: string | null): number | null {
    const parts = parseClockTimeParts(time);
    return parts ? parts.hour * 60 + parts.minute : null;
}

function parseClockTimeParts(time: string | null): { hour: number; minute: number } | null {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    const parts = time.split(':').map((part) => Number.parseInt(part, 10));
    return { hour: parts[0] ?? 0, minute: parts[1] ?? 0 };
}

function cryptoRandomHex(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    // `crypto` is read off `globalThis` (the mobile tsconfig has no DOM lib);
    // fall back to Math.random when the Web Crypto API is unavailable.
    const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => void } }).crypto;
    if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
        webCrypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function redirectTo(url: string): void {
    const location = (globalThis as { location?: { assign?: (target: string) => void } }).location;
    if (Platform.OS === 'web' && location && typeof location.assign === 'function') {
        location.assign(url);
        return;
    }
    void Linking.openURL(url);
}

/**
 * CMS status labels can arrive as editor HTML (`<p>…</p>`); the mobile
 * viewer renders plain text, so strip tags down to readable content.
 */
export function stripHtml(label: string | null): string | null {
    const value = label?.trim() ?? '';
    if (value === '') return null;
    const text = value
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>(?!$)/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    return text === '' ? null : text;
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS runtime, rewritten for parity with the legacy
 * `sh-shp-survey_js` plugin.
 *
 * Responsibilities:
 *   - fetch `/published/{key}` (definition + interpolated tokens +
 *     `runtimeConfig` + lockout state),
 *   - render one of the "lifecycle" UI states (loading, locked,
 *     edit-blocked, ready, submitting, done, timed-out, error),
 *   - hydrate from server-side draft / localStorage on mount when
 *     `restartOnRefresh` is false,
 *   - persist per-page progress to localStorage + `PUT /progress`
 *     every `autoSaveIntervalSeconds` seconds and on page change,
 *   - enforce client-side `timeoutMinutes` countdown,
 *   - copy URL params to `survey.setVariable('extra_param_<key>', v)`,
 *   - register a Save-as-PDF nav button when the feature flag +
 *     SurveyJS commercial license are configured,
 *   - send the `enforce` payload (oncePerUser / windowStart-End /
 *     responseId / progress) so the server re-validates the
 *     submission,
 *   - wire the file question pipeline (upload / download / clear)
 *     through the plugin's secure file endpoints,
 *   - render "already submitted" / "not yet active" Markdown labels
 *     from the section's style fields.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Group,
    Loader,
    Stack,
    Text,
} from '@mantine/core';

import {
    type IDraftPayload,
    type IPublishedSurvey,
    type ISubmissionEnforcePayload,
    RUNTIME_LICENSE_HEADER,
    deleteDraft,
    deleteSurveyFile,
    fetchDraft,
    fetchEditableResponse,
    fetchPublishedSurvey,
    saveDraft,
    submitSurveyAnswers,
    uploadSurveyFile,
} from '../api/surveys';
import {
    captureSurveyMeta,
    type ISurveyMeta,
} from './surveyMeta';
import { extractUrlParams } from './urlParams';
import { LocalDraftStore } from './localDraftStore';
import { CountdownTimer, type ITimerHandle } from './countdownTimer';
import { renderMarkdown } from './markdown';
import { registerCustomQuestionRuntime } from '../custom-questions/runtimeBridge';
import { registerCustomQuestions } from '../custom-questions/register';
import { getPluginApi } from './pluginApi';

import { buildSurveyJsTheme, useMantineLivePalette } from '../theme/mantineBridge';

type TPluginStyleSection = {
    id: number;
    fields?: Record<string, unknown>;
    style_name?: string;
    [key: string]: unknown;
};

export interface ISurveyJsStyleProps {
    style?: TPluginStyleSection;
    section?: TPluginStyleSection;
    values?: Record<string, unknown>;
    styleProps?: Record<string, string>;
    cssClass?: string;
}

interface ISurveyRuntimeBridge {
    Survey: React.ComponentType<{ model: unknown }>;
    Model: new (definition: unknown) => import('survey-core').ISurveyModel;
    setLicenseKey: (key: string) => void;
    Serializer: {
        addProperty: (className: string, descriptor: Record<string, unknown>) => void;
        getProperty: (className: string, name: string) => unknown;
    };
}

type LifecycleState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'not-active'; label: string | null }
    | { kind: 'locked'; label: string | null; reason?: string }
    | { kind: 'ready' }
    | { kind: 'submitting' }
    | { kind: 'submitted'; responseId: string; submittedAt: string }
    | { kind: 'timed-out'; label: string | null };

async function loadRuntime(): Promise<ISurveyRuntimeBridge> {
    const [core, ui] = await Promise.all([
        import('survey-core'),
        import('survey-react-ui'),
    ]);
    return {
        Survey: ui.Survey as unknown as React.ComponentType<{ model: unknown }>,
        Model: core.Model as unknown as new (definition: unknown) => import('survey-core').ISurveyModel,
        setLicenseKey: core.setLicenseKey as (key: string) => void,
        Serializer: core.Serializer,
    };
}

export function SurveyRuntime({
    style,
    section,
    styleProps,
    cssClass,
}: ISurveyJsStyleProps): React.ReactElement | null {
    const runtimeSection = section ?? style;
    const surveyIdentifier = useMemo(() => extractFieldString(runtimeSection, 'survey-js'), [runtimeSection]);
    const configuredTheme = useMemo(() => extractFieldString(runtimeSection, 'survey-js-theme'), [runtimeSection]);
    const config = useMemo(() => buildRuntimeConfigFromSection(runtimeSection), [runtimeSection]);
    const livePalette = useMantineLivePalette();

    const [bridge, setBridge] = useState<ISurveyRuntimeBridge | null>(null);
    const [published, setPublished] = useState<IPublishedSurvey | null>(null);
    const [lifecycle, setLifecycle] = useState<LifecycleState>({ kind: 'loading' });
    const [model, setModel] = useState<import('survey-core').ISurveyModel | null>(null);

    const draftStoreRef = useRef<LocalDraftStore | null>(null);
    const metaRef = useRef<ISurveyMeta | null>(null);
    const responseIdRef = useRef<string | null>(null);
    const timerRef = useRef<ITimerHandle | null>(null);
    const submittingRef = useRef(false);
    const editModeResponseIdRef = useRef<string | null>(null);

    // Step 1: load the SurveyJS runtime bundle (lazy) and register
    // the plugin's custom question types in the same module.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const b = await loadRuntime();
                if (cancelled) return;
                ensureRuntimeProperties(b);
                const pluginApi = getPluginApi();
                const isEnabled = (key: string, fallback: boolean): boolean => {
                    if (!pluginApi || typeof pluginApi.isFeatureEnabled !== 'function') return fallback;
                    try {
                        return pluginApi.isFeatureEnabled(key);
                    } catch {
                        return fallback;
                    }
                };
                await registerCustomQuestions({
                    flags: {
                        gpx: isEnabled('gpx', false),
                        video: isEnabled('video', false),
                        microphone: isEnabled('microphone', false),
                        richText: isEnabled('rich-text', true),
                    },
                    richTextEditor: pluginApi?.richTextEditor ?? null,
                });
                if (cancelled) return;
                setBridge(b);
            } catch (err) {
                if (!cancelled) {
                    setLifecycle({ kind: 'error', message: `SurveyJS runtime failed to load: ${(err as Error).message}` });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Step 2: fetch the published definition + runtimeConfig.
    useEffect(() => {
        if (!surveyIdentifier) return;
        let cancelled = false;
        const urlParams = config.urlParams ? extractUrlParams() : {};
        fetchPublishedSurvey(surveyIdentifier, configToServerConfig(config), urlParams)
            .then((data) => {
                if (cancelled) return;
                setPublished(data);
                draftStoreRef.current = new LocalDraftStore(`sh2-shp-survey-js:${data.surveyId}`);

                const editModeResponseId = readQueryParam('record_id') ?? readQueryParam('responseId');
                editModeResponseIdRef.current = editModeResponseId;

                if (data.state.lockoutReason && !editModeResponseId) {
                    setLifecycle({
                        kind: 'locked',
                        label: data.runtimeConfig.labelSurveyDone,
                        reason: data.state.lockoutReason.reason,
                    });
                    return;
                }
                if (isOutsideSchedule(data.runtimeConfig)) {
                    setLifecycle({
                        kind: 'not-active',
                        label: data.runtimeConfig.labelSurveyNotActive,
                    });
                    return;
                }
                setLifecycle({ kind: 'ready' });
            })
            .catch((err: Error) => {
                if (!cancelled) {
                    setLifecycle({ kind: 'error', message: `Survey not available: ${err.message}` });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [surveyIdentifier, config]);

    // Step 3: build the SurveyJS model once both bridge and definition arrived.
    useEffect(() => {
        if (!bridge || !published || lifecycle.kind !== 'ready') return;
        let disposed = false;

        const nextModel = new bridge.Model(published.definition);
        nextModel.applyTheme(
            buildSurveyJsTheme(
                configuredTheme ?? published.themeCode ?? 'default',
                livePalette,
            ),
        );

        const tokensAndExtras = { ...published.tokens, ...published.extraParams };
        for (const [key, value] of Object.entries(tokensAndExtras)) {
            nextModel.setVariable(key, value);
        }

        registerCustomQuestionRuntime(nextModel, {
            surveyKey: published.surveyId,
            responseIdProvider: () => responseIdRef.current ?? '',
            uploadFile: async (questionName, file) => {
                const responseId = ensureResponseId();
                return uploadSurveyFile(published.surveyId, {
                    responseId,
                    questionName,
                    file,
                });
            },
            deleteFile: async (fileId) => {
                await deleteSurveyFile(published.surveyId, fileId);
            },
        });

        if (config.savePdf && published.runtimeConfig.savePdf) {
            const licenseKey = readRuntimeLicenseKey();
            if (licenseKey) {
                bridge.setLicenseKey(licenseKey);
            }
            registerSavePdfButton(nextModel, bridge);
        }

        // Step 4: hydrate (server draft / local cache / edit-mode response).
        void hydrateModel(nextModel, {
            published,
            config,
            draftStore: draftStoreRef.current,
            editModeResponseId: editModeResponseIdRef.current,
            assignResponseId(value) {
                responseIdRef.current = value;
            },
            captureMeta(value) {
                metaRef.current = value;
            },
        });

        // Step 5: autosave + page change persistence.
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
        nextModel.onValueChanged.add(() => {
            // local cache only — server-side save is the autosave interval.
            const responseId = ensureResponseId();
            const meta = metaRef.current;
            draftStoreRef.current?.save({
                responseId,
                pageNo: nextModel.currentPageNo,
                data: nextModel.data,
                meta,
            });
        });

        // Step 6: timeout enforcement.
        if (published.runtimeConfig.timeoutMinutes > 0) {
            timerRef.current = new CountdownTimer({
                durationMs: published.runtimeConfig.timeoutMinutes * 60 * 1000,
                onExpire: () => {
                    if (disposed || submittingRef.current) return;
                    setLifecycle({
                        kind: 'timed-out',
                        label: published.runtimeConfig.labelSurveyNotActive,
                    });
                    if (draftStoreRef.current && responseIdRef.current) {
                        draftStoreRef.current.clear(responseIdRef.current);
                    }
                    void deleteDraft(published.surveyId, responseIdRef.current ?? undefined).catch(() => {});
                },
            });
            timerRef.current.start();
        }

        // Step 7: completion.
        nextModel.onComplete.add((sender) => {
            submittingRef.current = true;
            setLifecycle({ kind: 'submitting' });
            const enforce = buildEnforcePayload(config, responseIdRef.current, {
                pageNo: sender.currentPageNo,
                triggerType: 'finished',
                meta: metaRef.current,
                editMode: editModeResponseIdRef.current !== null,
            });
            void submitSurveyAnswers(published.surveyId, sender.data, enforce)
                .then((result) => {
                    if (disposed) return;
                    submittingRef.current = false;
                    responseIdRef.current = result.responseId;
                    if (draftStoreRef.current) {
                        draftStoreRef.current.clearAll();
                    }
                    if (config.oncePerUser || config.oncePerSchedule) {
                        setLifecycle({
                            kind: 'locked',
                            label: published.runtimeConfig.labelSurveyDone,
                            reason: config.oncePerUser
                                ? 'already_submitted_once'
                                : 'already_submitted_in_window',
                        });
                    } else {
                        setLifecycle({
                            kind: 'submitted',
                            responseId: result.responseId,
                            submittedAt: result.submittedAt,
                        });
                    }
                    if (config.redirectAtEnd && typeof window !== 'undefined') {
                        window.location.assign(config.redirectAtEnd);
                    }
                })
                .catch((err) => {
                    submittingRef.current = false;
                    if (disposed) return;
                    const reason = (err as { reason?: string }).reason ?? '';
                    if (reason === 'already_submitted_once' || reason === 'already_submitted_in_window') {
                        setLifecycle({
                            kind: 'locked',
                            label: published.runtimeConfig.labelSurveyDone,
                            reason,
                        });
                        return;
                    }
                    setLifecycle({
                        kind: 'error',
                        message: `Survey submission failed: ${(err as Error).message}`,
                    });
                });
        });

        setModel(nextModel);

        return () => {
            disposed = true;
            if (autosaveTimer) clearInterval(autosaveTimer);
            timerRef.current?.cancel();
            timerRef.current = null;
        };

        function ensureResponseId(): string {
            if (responseIdRef.current === null) {
                responseIdRef.current = `R_${cryptoRandomHex(8)}`;
            }
            return responseIdRef.current;
        }

        async function persistProgress(survey: import('survey-core').ISurveyModel, triggerType: string): Promise<void> {
            if (!published) return;
            const responseId = ensureResponseId();
            const meta = metaRef.current;
            const localPayload = {
                responseId,
                pageNo: survey.currentPageNo,
                data: survey.data,
                meta,
            };
            draftStoreRef.current?.save(localPayload);
            try {
                await saveDraft(published.surveyId, {
                    responseId,
                    pageNo: survey.currentPageNo,
                    payload: {
                        data: survey.data,
                        meta,
                        triggerType,
                        locale: survey.locale,
                    },
                });
            } catch {
                // Network failures are non-fatal: localStorage already
                // holds the answer; the next autosave will retry.
            }
        }
    }, [bridge, published, configuredTheme, livePalette, config]);

    const startOver = useCallback(() => {
        if (!published || !model) return;
        if (draftStoreRef.current && responseIdRef.current) {
            draftStoreRef.current.clear(responseIdRef.current);
        }
        responseIdRef.current = null;
        metaRef.current = captureSurveyMeta();
        model.clear(true, true);
    }, [published, model]);

    if (!surveyIdentifier) {
        return (
            <Alert color="yellow" title="Configuration error">
                The SurveyJS style is missing a selected survey on this section.
            </Alert>
        );
    }

    if (lifecycle.kind === 'error') {
        return (
            <Alert color="red" title="Survey unavailable">
                {lifecycle.message}
            </Alert>
        );
    }

    // These lifecycle states intentionally render before the generic
    // loading guard because they do not build a SurveyJS model at all.
    if (lifecycle.kind === 'not-active') {
        return renderInfoBlock(
            lifecycle.label,
            'gray',
        );
    }

    if (lifecycle.kind === 'locked') {
        return renderInfoBlock(
            lifecycle.label,
            'blue',
        );
    }

    if (lifecycle.kind === 'timed-out') {
        return renderInfoBlock(
            lifecycle.label,
            'orange',
        );
    }

    if (lifecycle.kind === 'loading' || !bridge || !published || !model) {
        return (
            <Stack align="center" gap="xs" py="md">
                <Loader size="md" />
                <Text>Loading survey…</Text>
            </Stack>
        );
    }

    if (lifecycle.kind === 'submitting') {
        return (
            <Stack align="center" gap="xs" py="md">
                <Loader size="md" />
                <Text>Submitting your response…</Text>
            </Stack>
        );
    }

    if (lifecycle.kind === 'submitted') {
        return (
            <Stack>
                <Alert color="green" title="Response recorded">
                    Thank you — your response was recorded at {lifecycle.submittedAt}.
                </Alert>
                <Group>
                    <Button variant="default" onClick={startOver}>
                        Start a new response
                    </Button>
                </Group>
            </Stack>
        );
    }

    const Survey = bridge.Survey;
    return (
        <Box
            className={['surveyjs-runtime-host', cssClass].filter(Boolean).join(' ')}
            {...styleProps}
        >
            <Survey model={model} />
        </Box>
    );
}

function renderInfoBlock(label: string | null, color: string): React.ReactElement | null {
    const html = renderStatusLabel(label);
    if (html === null) {
        return null;
    }
    return (
        <Alert color={color}>
            <Box dangerouslySetInnerHTML={{ __html: html }} />
        </Alert>
    );
}

function renderStatusLabel(label: string | null): string | null {
    const value = label?.trim() ?? '';
    if (value === '') {
        return null;
    }

    // CMS translation fields often arrive as already-rendered HTML
    // (`<p>...</p>` from the editor). Preserve that as-is instead of
    // escaping it through the markdown fallback path. Empty editor
    // output like `<p></p>` or `<p>&nbsp;</p>` counts as "not set".
    if (value.startsWith('<') && value.endsWith('>')) {
        return hasMeaningfulHtmlContent(value) ? value : null;
    }

    const rendered = renderMarkdown(value);
    return hasMeaningfulHtmlContent(rendered) ? rendered : null;
}

function hasMeaningfulHtmlContent(value: string): boolean {
    const text = value
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    return text !== '';
}

interface IHydrateArgs {
    published: IPublishedSurvey;
    config: IRuntimeSectionConfig;
    draftStore: LocalDraftStore | null;
    editModeResponseId: string | null;
    assignResponseId: (value: string) => void;
    captureMeta: (value: ISurveyMeta) => void;
}

async function hydrateModel(model: import('survey-core').ISurveyModel, args: IHydrateArgs): Promise<void> {
    const { published, config, draftStore, editModeResponseId, assignResponseId, captureMeta } = args;
    captureMeta(captureSurveyMeta());

    if (editModeResponseId) {
        const editable = await fetchEditableResponse(published.surveyId, editModeResponseId).catch(() => null);
        if (editable) {
            assignResponseId(editable.responseId);
            model.data = { ...editable.answers };
            return;
        }
    }

    if (config.restartOnRefresh) {
        const fresh = `R_${cryptoRandomHex(8)}`;
        assignResponseId(fresh);
        return;
    }

    // server-side draft has priority over local cache for cross-device resume.
    let restored: { responseId: string; pageNo: number; data: Record<string, unknown> } | null = null;
    try {
        const draft: IDraftPayload | null = await fetchDraft(
            published.surveyId,
            published.state.draft?.responseId,
        );
        if (draft) {
            restored = {
                responseId: draft.responseId,
                pageNo: draft.pageNo,
                data: extractDraftData(draft.payload),
            };
        }
    } catch {
        // ignore — we still attempt the local cache below.
    }

    if (!restored && !published.state.completedResponseId && draftStore !== null) {
        const local = draftStore.loadLatest();
        if (local) {
            restored = { responseId: local.responseId, pageNo: local.pageNo, data: local.data };
        }
    }

    if (restored) {
        assignResponseId(restored.responseId);
        model.data = { ...restored.data };
        if (Number.isInteger(restored.pageNo) && restored.pageNo >= 0) {
            model.currentPageNo = restored.pageNo;
        }
    } else {
        assignResponseId(`R_${cryptoRandomHex(8)}`);
    }
}

function extractDraftData(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
    }
    return {};
}

function readRuntimeLicenseKey(): string {
    if (typeof window === 'undefined') return '';
    return (window as Window & { __SURVEYJS_LICENSE_KEY?: string }).__SURVEYJS_LICENSE_KEY ?? '';
}

function buildEnforcePayload(
    config: IRuntimeSectionConfig,
    responseId: string | null,
    progress: { pageNo: number; triggerType: string; meta: ISurveyMeta | null; editMode?: boolean },
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
        editMode: progress.editMode ?? false,
        progress: {
            pageNo: progress.pageNo,
            triggerType: progress.triggerType,
            meta: progress.meta,
        },
    };
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

    return {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
    };
}

function parseClockTimeParts(time: string | null): { hour: number; minute: number } | null {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    const parts = time.split(':').map((part) => Number.parseInt(part, 10));
    return {
        hour: parts[0] ?? 0,
        minute: parts[1] ?? 0,
    };
}

function isOutsideSchedule(config: { startTime: string | null; endTime: string | null }): boolean {
    if (!config.startTime || !config.endTime) return false;
    if (config.startTime === '00:00' && config.endTime === '00:00') return false;
    const now = new Date();
    const start = parseClockTime(config.startTime);
    const end = parseClockTime(config.endTime);
    if (start === null || end === null) return false;
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (start <= end) {
        return minutesNow < start || minutesNow > end;
    }
    return minutesNow > end && minutesNow < start;
}

function parseClockTime(time: string | null): number | null {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    const parts = time.split(':').map((part) => Number.parseInt(part, 10));
    const hh = parts[0] ?? 0;
    const mm = parts[1] ?? 0;
    return hh * 60 + mm;
}

function readQueryParam(name: string): string | null {
    if (typeof window === 'undefined') return null;
    const value = new URL(window.location.href).searchParams.get(name);
    return value !== null && value !== '' ? value : null;
}

function cryptoRandomHex(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function configToServerConfig(config: IRuntimeSectionConfig): Record<string, unknown> {
    const scheduleWindow = config.oncePerSchedule
        ? resolveScheduleWindow(config.startTime, config.endTime)
        : null;
    return {
        restartOnRefresh: config.restartOnRefresh,
        autoSaveIntervalSeconds: config.autoSaveIntervalSeconds,
        timeoutMinutes: config.timeoutMinutes,
        savePdf: config.savePdf,
        closeModalAtEnd: config.closeModalAtEnd,
        redirectAtEnd: config.redirectAtEnd,
        urlParams: config.urlParams,
        startTime: config.startTime,
        endTime: config.endTime,
        oncePerUser: config.oncePerUser,
        oncePerSchedule: config.oncePerSchedule,
        ownEntriesOnly: config.ownEntriesOnly,
        allowAnonymous: config.allowAnonymous,
        windowStart: scheduleWindow?.start ?? null,
        windowEnd: scheduleWindow?.end ?? null,
        labelSurveyDone: config.labelSurveyDone,
        labelSurveyNotActive: config.labelSurveyNotActive,
        dataConfig: config.dataConfig,
        dynamicReplacement: config.dynamicReplacement,
    };
}

function ensureRuntimeProperties(bridge: ISurveyRuntimeBridge): void {
    if (bridge.Serializer.getProperty('page', 'resetOnBack')) return;
    bridge.Serializer.addProperty('page', {
        name: 'resetOnBack:boolean',
        default: false,
        category: 'general',
    });
}

function registerSavePdfButton(
    model: import('survey-core').ISurveyModel,
    bridge: Pick<ISurveyRuntimeBridge, 'setLicenseKey'>,
): void {
    if (typeof window === 'undefined') return;
    // We always wire the button: if the SurveyJS commercial PDF
    // package isn't installed, `exportSurveyAsPdf` falls back to the
    // browser print dialog, which lets the user "Save as PDF" too.
    model.addNavigationItem({
        id: 'sh2-save-pdf',
        title: 'Save as PDF',
        action: () => {
            void exportSurveyAsPdf(model, bridge, readRuntimeLicenseKey());
        },
    });
}

async function exportSurveyAsPdf(
    model: import('survey-core').ISurveyModel,
    bridge: Pick<ISurveyRuntimeBridge, 'setLicenseKey'>,
    licenseKey: string,
): Promise<void> {
    try {
        if (licenseKey) {
            bridge.setLicenseKey(licenseKey);
        }
        // `survey-pdf` is an optional commercial dependency. We
        // dynamically import it so non-PDF deployments don't pay
        // for the bundle. When it isn't installed we fall back to
        // the browser's built-in print dialog, which still lets the
        // user save a PDF copy via "Save as PDF" in the print
        // destination picker — keeping the button useful for every
        // operator instead of throwing.
        const mod = (await import('survey-pdf')) as unknown as {
            SurveyPDF: new (definition: unknown, options: unknown) => {
                data: Record<string, unknown>;
                save: (filename: string) => void;
            };
        };
        const survey = model as unknown as { jsonObj?: unknown; toJSON?: () => unknown };
        const definition = survey.jsonObj ?? survey.toJSON?.();
        const pdf = new mod.SurveyPDF(definition, undefined);
        pdf.data = (model as { data: Record<string, unknown> }).data;
        pdf.save(`survey-${Date.now()}.pdf`);
    } catch {
        if (typeof window !== 'undefined' && typeof window.print === 'function') {
            window.print();
        }
    }
}

export interface IRuntimeSectionConfig {
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
    dataConfig: Record<string, unknown>;
    dynamicReplacement: Record<string, unknown>;
}

function buildRuntimeConfigFromSection(section?: TPluginStyleSection): IRuntimeSectionConfig {
    return {
        restartOnRefresh: extractFieldBoolean(section, 'restart_on_refresh', false),
        autoSaveIntervalSeconds: extractFieldNumber(section, 'auto_save_interval', 0),
        timeoutMinutes: extractFieldNumber(section, 'timeout', 0),
        savePdf: extractFieldBoolean(section, 'save_pdf', false),
        closeModalAtEnd: extractFieldBoolean(section, 'close_modal_at_end', false),
        redirectAtEnd: extractFieldString(section, 'redirect_at_end'),
        urlParams: extractFieldBoolean(section, 'url_params', false),
        startTime: extractFieldString(section, 'start_time'),
        endTime: extractFieldString(section, 'end_time'),
        oncePerUser: extractFieldBoolean(section, 'once_per_user', false),
        oncePerSchedule: extractFieldBoolean(section, 'once_per_schedule', false),
        ownEntriesOnly: extractFieldBoolean(section, 'own_entries_only', false),
        allowAnonymous: extractFieldBoolean(section, 'allow_anonymous', true),
        labelSurveyDone: extractFieldString(section, 'label_survey_done'),
        labelSurveyNotActive: extractFieldString(section, 'label_survey_not_active'),
        dataConfig: extractFieldJsonObject(section, 'data_config'),
        dynamicReplacement: extractFieldJsonObject(section, 'dynamic_replacement'),
    };
}

function extractFieldString(section: TPluginStyleSection | undefined, key: string): string | null {
    const value = section?.fields?.[key] ?? section?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (
        value &&
        typeof value === 'object' &&
        'content' in (value as Record<string, unknown>) &&
        (typeof (value as { content?: unknown }).content === 'string' ||
            typeof (value as { content?: unknown }).content === 'number')
    ) {
        const content = (value as { content: string | number }).content;
        return String(content).trim() || null;
    }
    return null;
}

function extractFieldBoolean(
    section: TPluginStyleSection | undefined,
    key: string,
    fallback: boolean,
): boolean {
    const raw = extractFieldString(section, key);
    if (raw === null) return fallback;
    return raw === '1' || raw.toLowerCase() === 'true';
}

function extractFieldNumber(
    section: TPluginStyleSection | undefined,
    key: string,
    fallback: number,
): number {
    const raw = extractFieldString(section, key);
    if (raw === null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function extractFieldJsonObject(
    section: TPluginStyleSection | undefined,
    key: string,
): Record<string, unknown> {
    const raw = extractFieldString(section, key);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // fall through to empty fallback below
    }
    return {};
}

// keep the export so the legacy import in `index.ts` still wires up
// the same component while the file is named `SurveyJsStyle.tsx`.
export const SurveyJsStyle = SurveyRuntime;

// Re-export the runtime license header constant so an integration test
// can assert the runtime forwards the host's license key as expected.
export { RUNTIME_LICENSE_HEADER };

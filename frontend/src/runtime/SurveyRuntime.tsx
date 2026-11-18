/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Public SurveyJS runtime, rewritten for parity with the legacy
 * `sh-shp-survey_js` plugin.
 *
 * Responsibilities:
 *   - fetch `/published/{key}` for the page and section it is drawn on
 *     (definition with the section's variables filled in, the section's
 *     settings as `runtimeConfig`, lockout and window state). Every call
 *     names page and section; the server reads the settings and enforces
 *     the limits, the client sends none (rule 7.7),
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
 *   - send which response a submit is (responseId, edit mode, progress),
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
    type ISurveySectionRef,
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
import { LocalDraftStore } from './localDraftStore';
import { CountdownTimer, type ITimerHandle } from './countdownTimer';
import { stateMessageHtml } from './stateMessage';
import { registerCustomQuestionRuntime } from '../custom-questions/runtimeBridge';
import { registerCustomQuestions } from '../custom-questions/register';
import { getPluginApi } from './pluginApi';

import { applyMantineSurveyDefaults } from '../theme/surveyDefaults';

type TPluginStyleSection = {
    id: number;
    fields?: Record<string, unknown>;
    style_name?: string;
    [key: string]: unknown;
};

/** The page the section is drawn on (`IPluginStyleProps.page` of the plugin SDK). */
interface ISurveyHostPage {
    id: number | null;
    languageId: number | null;
    preview: boolean;
    routeParams: Record<string, string>;
}

export interface ISurveyJsStyleProps {
    style?: TPluginStyleSection;
    section?: TPluginStyleSection;
    values?: Record<string, unknown>;
    styleProps?: Record<string, string>;
    cssClass?: string;
    page?: ISurveyHostPage;
    /** The popup the page is shown in (`IPluginStyleProps.pageModal`). */
    pageModal?: { inModal: boolean; closeModal: () => void };
}

interface ISurveyRuntimeBridge {
    Survey: React.ComponentType<{ model: unknown }>;
    Model: new (definition: unknown) => import('survey-core').ISurveyModel;
    setLicenseKey: (key: string) => void;
    Serializer: {
        addProperty: (className: string, descriptor: Record<string, unknown>) => void;
        getProperty: (className: string, name: string) => unknown;
        findProperty: (className: string, name: string) => { defaultValue: unknown } | null;
    };
}

type LifecycleState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'not-active'; label: string | null }
    | { kind: 'login-required' }
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
    page,
    pageModal,
}: ISurveyJsStyleProps): React.ReactElement | null {
    const runtimeSection = section ?? style;
    // `survey-js` is the field's name before the upgrade, still in pages published before it.
    const surveyIdentifier = useMemo(
        () => extractFieldString(runtimeSection, 'survey_js') ?? extractFieldString(runtimeSection, 'survey-js'),
        [runtimeSection],
    );
    const sectionId = runtimeSection?.id;
    const pageId = page?.id ?? null;
    const languageId = page?.languageId ?? null;
    const preview = page?.preview ?? false;
    const routeParams = page?.routeParams;
    const sectionRef = useMemo<ISurveySectionRef | null>(
        () => (pageId !== null && sectionId !== undefined
            ? { pageId, sectionId, languageId, preview, routeParams: routeParams ?? {} }
            : null),
        [pageId, sectionId, languageId, preview, routeParams],
    );

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
    // Read at submit time, so a new popup object does not rebuild the survey.
    const pageModalRef = useRef(pageModal);
    pageModalRef.current = pageModal;

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
        if (!surveyIdentifier || !sectionRef) return;
        let cancelled = false;
        fetchPublishedSurvey(surveyIdentifier, sectionRef)
            .then((data) => {
                if (cancelled) return;
                if (data.runtimeConfig.autoSessionKey) {
                    ensureSessionKeyInUrl();
                }
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
                if (data.state.notActive) {
                    setLifecycle({
                        kind: 'not-active',
                        label: data.runtimeConfig.labelSurveyNotActive,
                    });
                    return;
                }
                setLifecycle({ kind: 'ready' });
            })
            .catch((err: Error & { reason?: string }) => {
                if (cancelled) return;
                if (err.reason === 'authentication_required') {
                    setLifecycle({ kind: 'login-required' });
                    return;
                }
                setLifecycle({ kind: 'error', message: `Survey not available: ${err.message}` });
            });
        return () => {
            cancelled = true;
        };
    }, [surveyIdentifier, sectionRef]);

    // Step 3: build the SurveyJS model once both bridge and definition arrived.
    useEffect(() => {
        if (!bridge || !published || !sectionRef || lifecycle.kind !== 'ready') return;
        const config = published.runtimeConfig;
        const section: ISurveySectionRef = sectionRef;
        let disposed = false;

        const nextModel = new bridge.Model(published.definition);
        // The look comes from `theme/mantine-adapter.css`; no theme is
        // applied here. The prefix keeps HTML ids unique when a page
        // shows more than one survey.
        nextModel.elementIdPrefix = `surveyjs-${sectionId ?? published.surveyId}-`;

        for (const [key, value] of Object.entries(published.extraParams)) {
            nextModel.setVariable(key, value);
        }

        registerCustomQuestionRuntime(nextModel, {
            surveyKey: published.surveyId,
            responseIdProvider: () => responseIdRef.current ?? '',
            uploadFile: async (questionName, file) => {
                const responseId = ensureResponseId();
                return uploadSurveyFile(published.surveyId, sectionRef, {
                    responseId,
                    questionName,
                    file,
                });
            },
            deleteFile: async (fileId) => {
                await deleteSurveyFile(published.surveyId, sectionRef, fileId);
            },
        });

        if (config.savePdf) {
            const licenseKey = readRuntimeLicenseKey();
            if (licenseKey) {
                bridge.setLicenseKey(licenseKey);
            }
            registerSavePdfButton(nextModel, bridge);
        }

        // Step 4: hydrate (server draft / local cache / edit-mode response).
        void hydrateModel(nextModel, {
            published,
            sectionRef,
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
                    void deleteDraft(published.surveyId, sectionRef, responseIdRef.current ?? undefined).catch(() => {});
                },
            });
            timerRef.current.start();
        }

        // Step 7: completion.
        nextModel.onComplete.add((sender) => {
            submittingRef.current = true;
            setLifecycle({ kind: 'submitting' });
            void submitSurveyAnswers(published.surveyId, sectionRef, sender.data, {
                responseId: responseIdRef.current ?? undefined,
                editMode: editModeResponseIdRef.current !== null,
                progress: { pageNo: sender.currentPageNo, meta: metaRef.current, locale: sender.locale },
            })
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
                    const popup = pageModalRef.current;
                    if (config.closeModalOnSave && popup?.inModal) {
                        popup.closeModal();
                    } else if (config.redirectAtEnd && typeof window !== 'undefined') {
                        window.location.assign(config.redirectAtEnd);
                    }
                })
                .catch((err) => {
                    submittingRef.current = false;
                    if (disposed) return;
                    const reason = (err as { reason?: string }).reason ?? '';
                    if (reason === 'not_active') {
                        setLifecycle({ kind: 'not-active', label: config.labelSurveyNotActive });
                        return;
                    }
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
                await saveDraft(published.surveyId, section, {
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
    }, [bridge, published, sectionId, sectionRef]);

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
            <StateFrame>
                <Alert color="yellow" title="Configuration error">
                    The SurveyJS style is missing a selected survey on this section.
                </Alert>
            </StateFrame>
        );
    }

    if (lifecycle.kind === 'error') {
        return (
            <StateFrame>
                <Alert color="red" title="Survey unavailable">
                    {lifecycle.message}
                </Alert>
            </StateFrame>
        );
    }

    // These lifecycle states intentionally render before the generic
    // loading guard because they do not build a SurveyJS model at all.
    if (lifecycle.kind === 'not-active') {
        return renderInfoBlock(lifecycle.label, 'gray', 'This survey is not open right now.');
    }

    if (lifecycle.kind === 'login-required') {
        return (
            <StateFrame>
                <Alert color="blue">Please sign in to answer this survey.</Alert>
            </StateFrame>
        );
    }

    if (lifecycle.kind === 'locked') {
        return renderInfoBlock(lifecycle.label, 'blue', 'You have already completed this survey.');
    }

    if (lifecycle.kind === 'timed-out') {
        return renderInfoBlock(lifecycle.label, 'orange', 'The time for this survey is over.');
    }

    if (lifecycle.kind === 'loading' || !bridge || !published || !model) {
        return (
            <StateFrame>
                <Stack align="center" gap="xs">
                    <Loader size="md" />
                    <Text>Loading survey…</Text>
                </Stack>
            </StateFrame>
        );
    }

    if (lifecycle.kind === 'submitting') {
        return (
            <StateFrame>
                <Stack align="center" gap="xs">
                    <Loader size="md" />
                    <Text>Submitting your response…</Text>
                </Stack>
            </StateFrame>
        );
    }

    if (lifecycle.kind === 'submitted') {
        return (
            <StateFrame>
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
            </StateFrame>
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

/**
 * Spacing around a message shown instead of the survey (loading, done,
 * closed, error). The width comes from the page tree, as for the survey.
 */
function StateFrame({ children }: { children: React.ReactNode }): React.ReactElement {
    return <Box py="md">{children}</Box>;
}

function renderInfoBlock(label: string | null, color: string, fallback: string): React.ReactElement {
    return (
        <StateFrame>
            <Alert color={color}>
                <Box dangerouslySetInnerHTML={{ __html: stateMessageHtml(label, fallback) }} />
            </Alert>
        </StateFrame>
    );
}


interface IHydrateArgs {
    published: IPublishedSurvey;
    sectionRef: ISurveySectionRef;
    draftStore: LocalDraftStore | null;
    editModeResponseId: string | null;
    assignResponseId: (value: string) => void;
    captureMeta: (value: ISurveyMeta) => void;
}

async function hydrateModel(model: import('survey-core').ISurveyModel, args: IHydrateArgs): Promise<void> {
    const { published, sectionRef, draftStore, editModeResponseId, assignResponseId, captureMeta } = args;
    captureMeta(captureSurveyMeta());

    if (editModeResponseId) {
        const editable = await fetchEditableResponse(published.surveyId, sectionRef, editModeResponseId).catch(() => null);
        if (editable) {
            assignResponseId(editable.responseId);
            model.data = { ...editable.answers };
            return;
        }
    }

    if (published.runtimeConfig.restartOnRefresh) {
        const fresh = `R_${cryptoRandomHex(8)}`;
        assignResponseId(fresh);
        return;
    }

    // server-side draft has priority over local cache for cross-device resume.
    let restored: { responseId: string; pageNo: number; data: Record<string, unknown> } | null = null;
    try {
        const draft: IDraftPayload | null = await fetchDraft(
            published.surveyId,
            sectionRef,
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

    // With keyed rows the response is the one the link names, never this
    // browser's latest: on a shared device that could be someone else's.
    if (!restored && !published.state.completedResponseId && !published.runtimeConfig.keyedRows && draftStore !== null) {
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

/**
 * `auto_session_key`: a guest on a shared invite link gets a private `sid` in
 * the link on first open, so guests on the same link never resume each other
 * and the link continues the response on another device (it works as a
 * password). A link that already has one keeps it.
 */
function ensureSessionKeyInUrl(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('sid')) return;
    url.searchParams.set('sid', cryptoRandomHex(16));
    window.history.replaceState(window.history.state, '', url.toString());
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

function ensureRuntimeProperties(bridge: ISurveyRuntimeBridge): void {
    applyMantineSurveyDefaults(bridge.Serializer);
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

// keep the export so the legacy import in `index.ts` still wires up
// the same component while the file is named `SurveyJsStyle.tsx`.
export const SurveyJsStyle = SurveyRuntime;

// Re-export the runtime license header constant so an integration test
// can assert the runtime forwards the host's license key as expected.
export { RUNTIME_LICENSE_HEADER };

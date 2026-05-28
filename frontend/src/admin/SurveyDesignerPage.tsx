/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * SurveyJS Creator host page.
 *
 * Mounts `survey-creator-react` with the Mantine theme bridge, applies
 * the configured license key, and wires the Tiptap-based rich-text
 * adapter (provided by the host through `IPluginApi.richTextEditor`)
 * to the listed Creator property editors. Saving publishes a new
 * `survey_version` through the admin API.
 *
 * Collaborative editing is wired through `usePluginRealtime` (provided
 * by the host) on the `surveys/{surveyId}/editing` topic. The presence
 * indicator + auto-refresh logic is intentionally minimal here; the
 * full UX iteration belongs in a future release of the plugin.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Group,
    Loader,
    Paper,
    Stack,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import { IconCheck, IconEdit, IconX } from '@tabler/icons-react';
import { usePluginRealtime } from '@selfhelp/shared/plugin-sdk';

import {
    fetchLicenseKey,
    getSurvey,
    publishPresence,
    publishVersion,
    saveDraft,
    updateSurvey,
    type IAdminSurveyDetail,
} from '../api/surveys-admin';
import { buildCreatorTheme, buildSurveyJsTheme, useMantineLivePalette } from '../theme/mantineBridge';
import { getPluginApi } from '../runtime/pluginApi';
import { isRichTextEditorEnabled, registerTiptapPropertyEditors } from '../creator/richTextEditorAdapter';
import { registerCustomQuestions } from '../custom-questions/register';
import { computeDefinitionDiff, formatChangeSummary } from './definitionDiff';

interface ICreatorBridge {
    SurveyCreatorComponent: React.ComponentType<{ creator: unknown }>;
    SurveyCreator: new (options: Record<string, unknown>) => unknown;
    rawModule: Record<string, unknown>;
}

interface IThemeableCreator {
    applyTheme?: (theme: Record<string, unknown>) => void;
    applyCreatorTheme?: (theme: Record<string, unknown>) => void;
}

async function loadCreator(): Promise<ICreatorBridge> {
    const mod = await import('survey-creator-react');
    return {
        SurveyCreatorComponent: mod.SurveyCreatorComponent as unknown as React.ComponentType<{ creator: unknown }>,
        SurveyCreator: mod.SurveyCreator as unknown as new (options: Record<string, unknown>) => unknown,
        rawModule: mod as unknown as Record<string, unknown>,
    };
}

export interface ISurveyDesignerPageProps {
    surveyId?: number;
    onSurveyChanged?: (survey: IAdminSurveyDetail) => void;
}

interface IEditingEvent {
    type: 'presence' | 'draft_saved' | 'version_published';
    state?: 'editing' | 'idle' | 'left';
    userId?: number;
    userName?: string;
    at?: string;
    savedByUserId?: number | null;
    publishedByUserId?: number | null;
    revision?: number;
}

export function SurveyDesignerPage({ surveyId, onSurveyChanged }: ISurveyDesignerPageProps = {}): React.ReactElement {
    const [bridge, setBridge] = useState<ICreatorBridge | null>(null);
    const [survey, setSurvey] = useState<IAdminSurveyDetail | null>(null);
    const [creator, setCreator] = useState<unknown>(null);
    const [fatalError, setFatalError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [licenseConfigured, setLicenseConfigured] = useState<boolean | null>(null);
    const [saving, setSaving] = useState<boolean>(false);
    const [publishing, setPublishing] = useState<boolean>(false);
    const [presence, setPresence] = useState<Record<number, { name: string; at: string; state: string }>>({});
    const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState<boolean>(false);
    const [changeCount, setChangeCount] = useState<number>(0);
    const [renamingTitle, setRenamingTitle] = useState<boolean>(false);
    const [titleValue, setTitleValue] = useState<string>('');
    const [savingTitle, setSavingTitle] = useState<boolean>(false);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const livePalette = useMantineLivePalette();
    const themeCode = survey?.themeCode ?? 'default';

    const realtime = usePluginRealtime<IEditingEvent>({
        pluginId: 'sh2-shp-survey-js',
        topic: 'surveys/{surveyId}/editing',
        topicParams: surveyId ? { surveyId: String(surveyId) } : {},
        enabled: Boolean(surveyId),
    });

    useEffect(() => {
        let cancelled = false;
        loadCreator().then((b) => {
            if (!cancelled) setBridge(b);
        }).catch((err: Error) => setFatalError(`Creator failed to load: ${err.message}`));
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!surveyId) {
            setSurvey(null);
            setCreator(null);
            setHasUnpublishedChanges(false);
            setChangeCount(0);
            setActionError(null);
            return;
        }
        let cancelled = false;
        setSurvey(null);
        setCreator(null);
        setHasUnpublishedChanges(false);
        setChangeCount(0);
        setActionError(null);
        getSurvey(surveyId).then((data) => {
            if (!cancelled) {
                setSurvey(data);
                onSurveyChanged?.(data);
            }
        }).catch((err: Error) => setFatalError(`Failed to load survey: ${err.message}`));
        return () => { cancelled = true; };
    }, [onSurveyChanged, surveyId]);

    useEffect(() => {
        if (!surveyId) return;
        void publishPresence(surveyId, 'editing').catch(() => undefined);
        const timer = window.setInterval(() => {
            void publishPresence(surveyId, document.hidden ? 'idle' : 'editing').catch(() => undefined);
        }, 30000);
        const onVisibility = (): void => {
            void publishPresence(surveyId, document.hidden ? 'idle' : 'editing').catch(() => undefined);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
            void publishPresence(surveyId, 'left').catch(() => undefined);
        };
    }, [surveyId]);

    useEffect(() => {
        const event = realtime.data;
        if (!event || event.type !== 'presence' || !event.userId || !event.userName || !event.at) {
            return;
        }
        setPresence((current) => {
            const next = { ...current };
            if (event.state === 'left') {
                delete next[event.userId as number];
                return next;
            }
            next[event.userId as number] = {
                name: event.userName as string,
                at: event.at as string,
                state: event.state ?? 'editing',
            };
            return next;
        });
    }, [realtime.data]);

    const otherEditors = useMemo(
        () => Object.values(presence).filter((entry) => Date.now() - new Date(entry.at).getTime() < 90000),
        [presence],
    );

    const reloadSurvey = useCallback(async (): Promise<IAdminSurveyDetail | null> => {
        if (!surveyId) return null;
        const data = await getSurvey(surveyId);
        setSurvey(data);
        onSurveyChanged?.(data);
        return data;
    }, [onSurveyChanged, surveyId]);

    const currentDefinition = useCallback((): Record<string, unknown> => {
        if (!creator) return { pages: [] };
        const json = (creator as { JSON: Record<string, unknown> }).JSON;
        return Object.keys(json).length === 0 ? { pages: [] } : json;
    }, [creator]);

    const recomputeChanges = useCallback((): void => {
        if (!survey) {
            setHasUnpublishedChanges(false);
            setChangeCount(0);
            return;
        }
        const current = currentDefinition();
        const published = survey.publishedDefinition ?? null;
        const diff = computeDefinitionDiff(published, current);
        setHasUnpublishedChanges(diff.hasChanges);
        setChangeCount(diff.totalChanges);
    }, [currentDefinition, survey]);

    const applyDesignerThemes = useCallback((instance: unknown): void => {
        const themed = instance as IThemeableCreator;
        themed.applyTheme?.(buildSurveyJsTheme(themeCode, livePalette));
        themed.applyCreatorTheme?.(buildCreatorTheme(themeCode, livePalette));
    }, [livePalette, themeCode]);

    useEffect(() => {
        if (renamingTitle && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [renamingTitle]);

    const startRenameTitle = useCallback((): void => {
        if (!survey) return;
        setTitleValue(survey.name);
        setRenamingTitle(true);
    }, [survey]);

    const cancelRenameTitle = useCallback((): void => {
        setRenamingTitle(false);
        setTitleValue('');
    }, []);

    const commitRenameTitle = useCallback(async (): Promise<void> => {
        if (!survey) return;
        const trimmed = titleValue.trim();
        if (trimmed === '' || trimmed === survey.name) {
            cancelRenameTitle();
            return;
        }
        setSavingTitle(true);
        setActionError(null);
        try {
            await updateSurvey(survey.id, { name: trimmed });
            const refreshed = await getSurvey(survey.id);
            setSurvey(refreshed);
            onSurveyChanged?.(refreshed);
            setRenamingTitle(false);
            setTitleValue('');
        } catch (err) {
            setActionError(`Rename failed: ${(err as Error).message}`);
        } finally {
            setSavingTitle(false);
        }
    }, [cancelRenameTitle, onSurveyChanged, survey, titleValue]);

    const handleSaveDraft = useCallback(async (force = false): Promise<boolean> => {
        if (!surveyId || !survey) return false;
        setSaving(true);
        setActionError(null);
        try {
            const updated = await saveDraft(surveyId, {
                definition: currentDefinition(),
                expectedDraftHash: survey.draftHash,
                force,
            });
            setSurvey(updated);
            onSurveyChanged?.(updated);
            return true;
        } catch (err) {
            setActionError(`Save failed: ${(err as Error).message}`);
            return false;
        } finally {
            setSaving(false);
        }
    }, [currentDefinition, onSurveyChanged, survey, surveyId]);

    const handlePublish = useCallback(async (): Promise<void> => {
        if (!surveyId || !survey) return;
        setPublishing(true);
        setActionError(null);
        try {
            await publishVersion(surveyId, {
                definition: currentDefinition(),
                expectedDraftHash: survey.draftHash,
            });
            await reloadSurvey();
        } catch (err) {
            setActionError(`Publish failed: ${(err as Error).message}`);
        } finally {
            setPublishing(false);
        }
    }, [currentDefinition, reloadSurvey, survey, surveyId]);

    useEffect(() => {
        if (!bridge) return;
        let cancelled = false;
        const init = async (): Promise<void> => {
            const license = await fetchLicenseKey().catch(() => ({ licenseKey: null, configured: false }));
            if (cancelled) return;
            setLicenseConfigured(Boolean(license.configured));
            // SurveyJS v2.x stopped accepting `licenseKey` as a
            // SurveyCreator constructor option (the value is silently
            // ignored — `survey-creator-core` 2.5.x has no `licenseKey`
            // string anywhere in its source). The supported path is
            // the global `setLicenseKey()` exported from `survey-core`,
            // which must be called BEFORE constructing the Creator so
            // the watermark check the Creator runs at boot sees the
            // active license. Without this call the Designer always
            // renders the "developer license required" banner even
            // when the SURVEYJS_LICENSE_KEY backend env var is set and
            // `fetchLicenseKey()` correctly returns a non-null key.
            if (license.licenseKey) {
                const surveyCore = await import('survey-core');
                if (typeof surveyCore.setLicenseKey === 'function') {
                    surveyCore.setLicenseKey(license.licenseKey);
                }
            }
            const options: Record<string, unknown> = {
                showLogicTab: true,
                isAutoSave: false,
                showThemeTab: true,
                showJSONEditorTab: true,
            };
            const instance = new bridge.SurveyCreator(options);
            applyDesignerThemes(instance);

            if (survey?.definition) {
                (instance as { JSON: Record<string, unknown> }).JSON = survey.definition;
            }

            // Expose a `richTextEditor` boolean on the Survey root so the
            // setting is editable from the property grid (Settings > General).
            // Falls back gracefully if the Serializer API shape changed.
            try {
                const SurveyMod = (bridge.rawModule as { Serializer?: { addProperty: (cls: string, prop: Record<string, unknown>) => void; getProperty?: (cls: string, name: string) => unknown } }).Serializer
                    ?? (await import('survey-core')).Serializer;
                if (SurveyMod && typeof SurveyMod.addProperty === 'function' && !(SurveyMod.getProperty?.('survey', 'richTextEditor'))) {
                    SurveyMod.addProperty('survey', {
                        name: 'richTextEditor:boolean',
                        category: 'general',
                        default: false,
                        displayName: 'Rich-text editor (Tiptap)',
                    });
                }
            } catch {
                // serializer registration is best-effort; designer still works.
            }

            // Per-survey opt-in: wire the host's Tiptap rich-text adapter
            // into the Creator property editors when the survey JSON has
            // `richTextEditor: true`. The registrar is a no-op when the
            // setting is missing/false or when the host did not provide a
            // `richTextEditor` adapter on `IPluginApi`.
            const pluginApi = getPluginApi();
            if (pluginApi && isRichTextEditorEnabled(survey?.definition ?? {})) {
                registerTiptapPropertyEditors(bridge.rawModule as never, pluginApi);
            }

            // Register every plugin-owned custom question type once so
            // the Creator toolbox shows them. Feature flag gating mirrors
            // the runtime registration so the Designer and the public
            // renderer expose the same set of components.
            const isFlagEnabled = (key: string, fallback: boolean): boolean => {
                if (!pluginApi || typeof pluginApi.isFeatureEnabled !== 'function') return fallback;
                try {
                    return pluginApi.isFeatureEnabled(key);
                } catch {
                    return fallback;
                }
            };
            await registerCustomQuestions({
                flags: {
                    gpx: isFlagEnabled('gpx', false),
                    video: isFlagEnabled('video', false),
                    microphone: isFlagEnabled('microphone', false),
                    richText: isFlagEnabled('rich-text', true),
                },
                richTextEditor: pluginApi?.richTextEditor ?? null,
            });
            const saveHandler = async (
                _id: unknown,
                success: (saved: boolean) => void,
            ): Promise<void> => {
                if (!surveyId) {
                    success(false);
                    return;
                }
                try {
                    const json = (instance as { JSON: Record<string, unknown> }).JSON;
                    await saveDraft(surveyId, {
                        definition: json,
                        expectedDraftHash: survey?.draftHash,
                    });
                    await reloadSurvey();
                    success(true);
                } catch (err) {
                    setActionError(`Save failed: ${(err as Error).message}`);
                    success(false);
                }
            };
            (instance as { saveSurveyFunc: typeof saveHandler }).saveSurveyFunc = saveHandler;

            // SurveyJS Creator exposes onModified which fires for every
            // mutation (toolbox drag, property edit, JSON editor change).
            // We re-compute the published-vs-current diff so the header
            // can disable Publish when nothing changed and show the
            // change counter.
            const onModified = (instance as {
                onModified?: { add: (fn: () => void) => void };
            }).onModified;
            if (onModified && typeof onModified.add === 'function') {
                onModified.add(() => {
                    const json = (instance as { JSON: Record<string, unknown> }).JSON;
                    const published = survey?.publishedDefinition ?? null;
                    const diff = computeDefinitionDiff(published, json);
                    setHasUnpublishedChanges(diff.hasChanges);
                    setChangeCount(diff.totalChanges);
                });
            }
            setCreator(instance);
            // initial diff after the Creator hydrates the current JSON.
            const initialJson = (instance as { JSON: Record<string, unknown> }).JSON;
            const initialDiff = computeDefinitionDiff(
                survey?.publishedDefinition ?? null,
                initialJson && Object.keys(initialJson).length > 0 ? initialJson : { pages: [] },
            );
            setHasUnpublishedChanges(initialDiff.hasChanges);
            setChangeCount(initialDiff.totalChanges);
        };
        void init();
        return () => { cancelled = true; };
    }, [applyDesignerThemes, bridge, reloadSurvey, survey, surveyId]);

    useEffect(() => {
        if (!creator) return;
        applyDesignerThemes(creator);
    }, [applyDesignerThemes, creator]);

    // Recompute the diff whenever the survey reloads (e.g. after publish)
    // so the header reflects the latest baseline.
    useEffect(() => {
        if (!creator || !survey) return;
        recomputeChanges();
    }, [creator, recomputeChanges, survey]);

    if (fatalError) {
        return (
            <Alert color="red" title="Survey Designer">
                {fatalError}
            </Alert>
        );
    }
    if (!surveyId) {
        return (
            <Paper
                withBorder
                p="md"
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                }}
            >
                <Stack gap="xs">
                    <Title order={3}>Survey Designer</Title>
                    <Text c="dimmed">Select a survey from the list to start designing.</Text>
                </Stack>
            </Paper>
        );
    }
    if (!bridge || !creator) {
        return (
            <Paper
                withBorder
                p="md"
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                }}
            >
                <Stack align="center" gap="xs">
                    <Loader size="md" />
                    <Text>Loading designer…</Text>
                </Stack>
            </Paper>
        );
    }
    const Component = bridge.SurveyCreatorComponent;
    // The Creator paints its own chrome (toolbox + tabs + property
    // grid). Wrapping it in a Mantine `Paper` keeps padding/borders
    // consistent with the rest of the admin shell while leaving the
    // Creator free to manage its internal layout.
    return (
        <Stack gap="sm">
            <Paper
                withBorder
                p="md"
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                }}
            >
                <Group justify="space-between" align="center" wrap="nowrap">
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                            {renamingTitle ? (
                                <Group gap="xs" wrap="nowrap" style={{ flex: 1 }}>
                                    <TextInput
                                        ref={titleInputRef}
                                        size="sm"
                                        value={titleValue}
                                        onChange={(e) => setTitleValue(e.currentTarget.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                void commitRenameTitle();
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault();
                                                cancelRenameTitle();
                                            }
                                        }}
                                        disabled={savingTitle}
                                        style={{ flex: 1, maxWidth: 360 }}
                                        aria-label="Rename survey"
                                    />
                                    <Tooltip label="Save (Enter)">
                                        <ActionIcon
                                            size="sm"
                                            color="green"
                                            variant="filled"
                                            onClick={() => void commitRenameTitle()}
                                            loading={savingTitle}
                                            aria-label="Save rename"
                                        >
                                            <IconCheck size={14} />
                                        </ActionIcon>
                                    </Tooltip>
                                    <Tooltip label="Cancel (Esc)">
                                        <ActionIcon
                                            size="sm"
                                            variant="subtle"
                                            onClick={cancelRenameTitle}
                                            disabled={savingTitle}
                                            aria-label="Cancel rename"
                                        >
                                            <IconX size={14} />
                                        </ActionIcon>
                                    </Tooltip>
                                </Group>
                            ) : (
                                <>
                                    <Title order={4} onDoubleClick={startRenameTitle} title="Double-click to rename">
                                        {survey?.name ?? 'Survey Designer'}
                                    </Title>
                                    <Tooltip label="Rename (double-click title)">
                                        <ActionIcon size="sm" variant="subtle" onClick={startRenameTitle} aria-label="Rename survey">
                                            <IconEdit size={14} />
                                        </ActionIcon>
                                    </Tooltip>
                                </>
                            )}
                            {survey?.currentRevision ? (
                                <Badge color="green" variant="light">Published v{survey.currentRevision}</Badge>
                            ) : (
                                <Badge color="yellow" variant="light">Draft only</Badge>
                            )}
                            {hasUnpublishedChanges && (
                                <Tooltip label="Unpublished changes vs the last published version">
                                    <Badge color="orange" variant="filled">
                                        {changeCount} unpublished {changeCount === 1 ? 'change' : 'changes'}
                                    </Badge>
                                </Tooltip>
                            )}
                        </Group>
                        <Text size="sm" c="dimmed">
                            Save drafts while editing. Publish when the survey is ready for respondents.
                            {!hasUnpublishedChanges && survey?.currentRevision && ' Publish is disabled until you make changes.'}
                        </Text>
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                        <Button variant="default" onClick={() => void handleSaveDraft()} loading={saving}>
                            Save draft
                        </Button>
                        <Tooltip
                            label={hasUnpublishedChanges
                                ? `Publish a new revision (${changeCount} change${changeCount === 1 ? '' : 's'})`
                                : 'No changes to publish'}
                        >
                            <Button
                                color="orange"
                                onClick={() => void handlePublish()}
                                loading={publishing}
                                disabled={!hasUnpublishedChanges}
                            >
                                Publish{hasUnpublishedChanges ? ` (${changeCount})` : ''}
                            </Button>
                        </Tooltip>
                    </Group>
                </Group>
            </Paper>
            {otherEditors.length > 0 && (
                <Alert color="yellow" title="Multiple editors are working on this survey">
                    {otherEditors.map((editor) => editor.name).join(', ')} also has this Designer open.
                    Save/publish conflicts are checked before overwriting the draft.
                </Alert>
            )}
            {realtime.error && (
                <Alert color="yellow" title="Editing presence unavailable">
                    Realtime editing status is disconnected. Draft conflict checks still protect saves.
                </Alert>
            )}
            {licenseConfigured === false && (
                <Alert color="yellow" title="SurveyJS license key not configured">
                    Editing and publishing still work. SurveyJS will show its upstream watermark until
                    <code>SURVEYJS_LICENSE_KEY</code> is configured in the backend environment.
                </Alert>
            )}
            {actionError && (
                <Alert color="red" title="Survey Designer">
                    {actionError}
                </Alert>
            )}
            <Paper withBorder p={0} className="surveyjs-creator-shell">
                <Component creator={creator} />
            </Paper>
        </Stack>
    );
}

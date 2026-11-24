/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The Design tab: the SurveyJS Creator with the site's Mantine look.
 *
 * The Creator is built once per survey. Saving a draft or publishing only
 * updates the survey record around it, so the editor keeps its undo history
 * and scroll position. It is read-only for a caller without the update
 * right; Publish shows only with the publish right.
 *
 * Draft conflicts: every save names the draft it started from. When someone
 * else saved in between, the server answers 409 and the editor offers to load
 * their version or overwrite it. Other editors with the survey open are shown
 * through the `surveys/{surveyId}/editing` realtime topic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { usePluginRealtime } from '@selfhelp/shared/plugin-sdk';

import {
    fetchLicenseKey,
    getSurvey,
    publishPresence,
    publishVersion,
    saveDraft,
    SurveyApiError,
    type IAdminSurveyDetail,
} from '../api/surveys-admin';
import { applyMantineSurveyDefaults } from '../theme/surveyDefaults';
import { getPluginApi } from '../runtime/pluginApi';
import { isRichTextEditorEnabled, registerTiptapPropertyEditors } from '../creator/richTextEditorAdapter';
import { registerCustomQuestions } from '../custom-questions/register';
import { computeDefinitionDiff, normalizeDefinition, type TSurveyModelConstructor } from './definitionDiff';

interface ICreatorBridge {
    SurveyCreatorComponent: React.ComponentType<{ creator: unknown }>;
    SurveyCreator: new (options: Record<string, unknown>) => unknown;
    rawModule: Record<string, unknown>;
}

interface ICreatorInstance {
    JSON: Record<string, unknown>;
    readOnly: boolean;
    saveSurveyFunc: (saveNo: unknown, callback: (no: unknown, success: boolean) => void) => void;
    onModified?: { add: (fn: () => void) => void };
    activeTab?: string;
    onActiveTabChanged?: { add: (fn: () => void) => void };
    getPlugin?: (name: string) => { model?: { onPropertyChanged?: { add: (fn: (sender: unknown, options: { name: string }) => void) => void } } } | undefined;
}

/**
 * The Creator's JSON tab keeps edits in its own text and copies them into the
 * survey only when the tab is left (surveyjs/survey-creator#7212), so saving
 * or publishing there would send the survey without them. Same guard as the
 * SelfHelp 1 plugin: point to the Designer tab first.
 */
const JSON_TAB = 'json';

async function loadCreator(): Promise<ICreatorBridge> {
    const mod = await import('survey-creator-react');
    return {
        SurveyCreatorComponent: mod.SurveyCreatorComponent as unknown as React.ComponentType<{ creator: unknown }>,
        SurveyCreator: mod.SurveyCreator as unknown as new (options: Record<string, unknown>) => unknown,
        rawModule: mod as unknown as Record<string, unknown>,
    };
}

export interface ISurveyDesignerPageProps {
    survey: IAdminSurveyDetail;
    onSurveyChanged: (survey: IAdminSurveyDetail) => void;
}

interface IEditingEvent {
    type: 'presence' | 'draft_saved' | 'version_published';
    state?: 'editing' | 'idle' | 'left';
    userId?: number;
    userName?: string;
    at?: string;
    draftHash?: string | null;
}

type TConflict = { action: 'save' | 'publish'; message: string } | null;

/** A draft saved in another window or by another editor: loaded here, or held back because of unsaved edits. */
type TRemoteDraft = 'loaded' | 'held' | null;

export function SurveyDesignerPage({ survey, onSurveyChanged }: ISurveyDesignerPageProps): React.ReactElement {
    const surveyId = survey.id;
    const canEdit = survey.rights.update;
    const canPublish = survey.rights.publish;

    const [bridge, setBridge] = useState<ICreatorBridge | null>(null);
    const [creator, setCreator] = useState<ICreatorInstance | null>(null);
    const [fatalError, setFatalError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [conflict, setConflict] = useState<TConflict>(null);
    const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
    const [dirty, setDirty] = useState<boolean>(false);
    const [changeCount, setChangeCount] = useState<number>(0);
    const [presence, setPresence] = useState<Record<number, { name: string; at: string }>>({});
    const [remoteDraft, setRemoteDraft] = useState<TRemoteDraft>(null);
    // Edited on the JSON tab and not yet taken into the survey; a save or publish there is refused with a note.
    const [jsonTabEdited, setJsonTabEdited] = useState<boolean>(false);
    const [jsonTabNote, setJsonTabNote] = useState<boolean>(false);

    // The latest survey record, read by the Creator's callbacks, which are
    // set once when it is built.
    const surveyRef = useRef(survey);
    surveyRef.current = survey;
    const surveyModelRef = useRef<TSurveyModelConstructor | null>(null);
    const ownUserIdRef = useRef<number | null>(null);
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    const busyRef = useRef(busy);
    busyRef.current = busy;
    const handledEventRef = useRef<IEditingEvent | null>(null);
    const normalizedPublishedRef = useRef<{ source: unknown; value: Record<string, unknown> | null } | null>(null);

    const realtime = usePluginRealtime<IEditingEvent>({
        pluginId: 'sh2-shp-survey-js',
        topic: 'surveys/{surveyId}/editing',
        topicParams: { surveyId: String(surveyId) },
        enabled: true,
    });

    /** The published definition as the Creator would write it, so unchanged questions compare equal. */
    const publishedForDiff = useCallback((): Record<string, unknown> | null => {
        const published = surveyRef.current.publishedDefinition ?? null;
        if (!surveyModelRef.current) return published;
        if (normalizedPublishedRef.current?.source !== published) {
            normalizedPublishedRef.current = {
                source: published,
                value: normalizeDefinition(published, surveyModelRef.current),
            };
        }
        return normalizedPublishedRef.current.value;
    }, []);

    const currentJson = useCallback((instance: ICreatorInstance): Record<string, unknown> => {
        const json = instance.JSON;
        return Object.keys(json).length === 0 ? { pages: [] } : json;
    }, []);

    const recomputeChanges = useCallback((instance: ICreatorInstance): void => {
        setChangeCount(computeDefinitionDiff(publishedForDiff(), currentJson(instance)).totalChanges);
    }, [currentJson, publishedForDiff]);

    const save = useCallback(async (force = false): Promise<boolean> => {
        if (!creator || !canEdit) return false;
        if (creator.activeTab === JSON_TAB) {
            setJsonTabNote(true);
            return false;
        }
        setBusy('save');
        setActionError(null);
        setConflict(null);
        try {
            const updated = await saveDraft(surveyId, {
                definition: currentJson(creator),
                expectedDraftHash: surveyRef.current.draftHash,
                force,
            });
            onSurveyChanged(updated);
            setDirty(false);
            setRemoteDraft(null);
            return true;
        } catch (err) {
            if (err instanceof SurveyApiError && err.reason === 'draft_conflict') {
                setConflict({ action: 'save', message: err.message });
            } else {
                setActionError(`Save failed: ${(err as Error).message}`);
            }
            return false;
        } finally {
            setBusy(null);
        }
    }, [canEdit, creator, currentJson, onSurveyChanged, surveyId]);

    const publish = useCallback(async (force = false): Promise<void> => {
        if (!creator || !canPublish) return;
        if (creator.activeTab === JSON_TAB) {
            setJsonTabNote(true);
            return;
        }
        setBusy('publish');
        setActionError(null);
        setConflict(null);
        try {
            await publishVersion(surveyId, {
                definition: currentJson(creator),
                expectedDraftHash: surveyRef.current.draftHash,
                force,
            });
        } catch (err) {
            if (err instanceof SurveyApiError && err.reason === 'draft_conflict') {
                // Someone else saved: nothing was stored, the editor offers their version or an overwrite.
                setConflict({ action: 'publish', message: err.message });
            } else {
                setActionError(`Publish failed: ${(err as Error).message}`);
                // Refused after the draft was saved (a renamed answered question, a reserved
                // name): carry on from that draft, or the next save would clash with it.
                if (err instanceof SurveyApiError && err.reason !== null) {
                    const fresh = await getSurvey(surveyId).catch(() => null);
                    if (fresh) {
                        onSurveyChanged(fresh);
                        setDirty(false);
                    }
                }
            }
            setBusy(null);
            return;
        }
        // Published. Reloading only refreshes the header; failing it must not read as a failed publish.
        setDirty(false);
        try {
            onSurveyChanged(await getSurvey(surveyId));
        } catch {
            setActionError('Published. The page could not reload the survey; reload the page to see the new version.');
        } finally {
            setBusy(null);
        }
    }, [canPublish, creator, currentJson, onSurveyChanged, surveyId]);

    const saveRef = useRef(save);
    saveRef.current = save;

    const loadTheirVersion = useCallback(async (): Promise<void> => {
        if (!creator) return;
        try {
            const fresh = await getSurvey(surveyId);
            creator.JSON = fresh.definition ?? { pages: [] };
            surveyRef.current = fresh;
            onSurveyChanged(fresh);
            recomputeChanges(creator);
            setDirty(false);
            setConflict(null);
            setRemoteDraft(null);
        } catch (err) {
            setActionError(`Could not load the saved version: ${(err as Error).message}`);
        }
    }, [creator, onSurveyChanged, recomputeChanges, surveyId]);

    useEffect(() => {
        let cancelled = false;
        loadCreator()
            .then((loaded) => {
                if (!cancelled) setBridge(loaded);
            })
            .catch((err: Error) => setFatalError(`The survey editor failed to load: ${err.message}`));
        return () => {
            cancelled = true;
        };
    }, []);

    // The Creator, built once per survey and edit right. Kept in a ref because
    // effects re-run while the component stays mounted (a hidden tab's effects
    // are cleaned up and run again when it shows), and a new Creator would
    // drop the edits and the undo history.
    const creatorBuildRef = useRef<{ key: string; instance: Promise<ICreatorInstance> } | null>(null);

    useEffect(() => {
        if (!bridge) return undefined;
        let cancelled = false;
        const build = async (): Promise<ICreatorInstance> => {
            const license = await fetchLicenseKey().catch(() => ({ licenseKey: null, configured: false }));
            // The key must be set before the Creator is built, or it shows the watermark.
            const surveyCore = await import('survey-core');
            if (license.licenseKey && typeof surveyCore.setLicenseKey === 'function') {
                surveyCore.setLicenseKey(license.licenseKey);
            }
            applyMantineSurveyDefaults(surveyCore.Serializer);
            surveyModelRef.current = surveyCore.Model as unknown as TSurveyModelConstructor;
            if (!surveyCore.Serializer.getProperty('survey', 'richTextEditor')) {
                surveyCore.Serializer.addProperty('survey', {
                    name: 'richTextEditor:boolean',
                    category: 'general',
                    default: false,
                    displayName: 'Rich-text editor (Tiptap)',
                });
            }

            const definition = surveyRef.current.definition ?? { pages: [] };
            const pluginApi = getPluginApi();
            if (pluginApi && isRichTextEditorEnabled(definition)) {
                registerTiptapPropertyEditors(bridge.rawModule as never, pluginApi);
            }
            const isFlagEnabled = (key: string, fallback: boolean): boolean => {
                try {
                    return pluginApi?.isFeatureEnabled(key) ?? fallback;
                } catch {
                    return fallback;
                }
            };
            // The same question types as the public survey.
            await registerCustomQuestions({
                flags: {
                    gpx: isFlagEnabled('gpx', false),
                    video: isFlagEnabled('video', false),
                    microphone: isFlagEnabled('microphone', false),
                    richText: isFlagEnabled('rich-text', true),
                },
                richTextEditor: pluginApi?.richTextEditor ?? null,
            });

            const instance = new bridge.SurveyCreator({
                showLogicTab: true,
                isAutoSave: false,
                // A survey always takes the site's look, so there is no theme to design.
                showThemeTab: false,
                showJSONEditorTab: true,
            }) as ICreatorInstance;
            instance.JSON = definition;
            instance.readOnly = !canEdit;
            // The Creator's own save button and Ctrl+S.
            instance.saveSurveyFunc = (saveNo, callback) => {
                void saveRef.current().then((ok) => callback(saveNo, ok));
            };
            instance.onModified?.add(() => {
                setDirty(true);
                recomputeChanges(instance);
            });
            // An edit on the JSON tab changes nothing the editor sees until the tab
            // is left; it enables Save and Publish so their click shows the note.
            instance.onActiveTabChanged?.add(() => {
                setJsonTabEdited(false);
                setJsonTabNote(false);
                if (instance.activeTab !== JSON_TAB) return;
                const model = instance.getPlugin?.(JSON_TAB)?.model;
                if (!model?.onPropertyChanged) {
                    setJsonTabEdited(true);
                    return;
                }
                model.onPropertyChanged.add((_sender, options) => {
                    if (options.name === 'text' || options.name === '_text') setJsonTabEdited(true);
                });
            });
            return instance;
        };
        const key = `${surveyId}:${canEdit ? 'edit' : 'view'}`;
        if (creatorBuildRef.current?.key !== key) {
            creatorBuildRef.current = { key, instance: build() };
        }
        creatorBuildRef.current.instance
            .then((instance) => {
                if (cancelled) return;
                recomputeChanges(instance);
                setCreator(instance);
            })
            .catch((err: Error) => setFatalError(`The survey editor failed to load: ${err.message}`));
        return () => {
            cancelled = true;
        };
    }, [bridge, canEdit, recomputeChanges, surveyId]);

    // A new published version is a new baseline for the change count.
    useEffect(() => {
        if (creator) recomputeChanges(creator);
    }, [creator, recomputeChanges, survey.publishedDefinition]);

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (event: BeforeUnloadEvent): void => {
            event.preventDefault();
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    // Tell other editors this survey is open here (a heartbeat this page sends, not a poll).
    // Only someone who may edit is announced; the effect stops while the tab is hidden.
    useEffect(() => {
        if (!canEdit) return undefined;
        const send = (state: 'editing' | 'idle' | 'left'): void => {
            void publishPresence(surveyId, state)
                .then((reply) => {
                    ownUserIdRef.current = reply.userId;
                })
                .catch(() => undefined);
        };
        send('editing');
        const timer = window.setInterval(() => send(document.hidden ? 'idle' : 'editing'), 30000);
        const onVisibility = (): void => send(document.hidden ? 'idle' : 'editing');
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
            send('left');
        };
    }, [canEdit, surveyId]);

    useEffect(() => {
        const event = realtime.data;
        if (!event || event.type !== 'presence' || !event.userId || !event.userName || !event.at) return;
        // This page's own heartbeat comes back over the topic too.
        if (event.userId === ownUserIdRef.current) return;
        const { userId, userName, at } = event;
        setPresence((current) => {
            const next = { ...current };
            if (event.state === 'left') {
                delete next[userId];
            } else {
                next[userId] = { name: userName, at };
            }
            return next;
        });
    }, [realtime.data]);

    // A save or publish elsewhere (another tab, another editor) arrives on the same topic.
    useEffect(() => {
        const event = realtime.data;
        if (!creator || !event || (event.type !== 'draft_saved' && event.type !== 'version_published')) return;
        // The effect also re-runs when its callbacks change; each event is handled once.
        if (handledEventRef.current === event) return;
        handledEventRef.current = event;
        // This page's own save or publish; it reloads the survey itself.
        if (busyRef.current !== null) return;
        if (event.type === 'draft_saved' && event.draftHash === surveyRef.current.draftHash) return;
        void getSurvey(surveyId)
            .then((fresh) => {
                const draftChanged = fresh.draftHash !== surveyRef.current.draftHash;
                if (draftChanged && dirtyRef.current) {
                    // Keep the edits and the old draft hash, so saving still reports the conflict.
                    setRemoteDraft('held');
                    return;
                }
                if (draftChanged) {
                    creator.JSON = fresh.definition ?? { pages: [] };
                    setDirty(false);
                    setRemoteDraft('loaded');
                }
                surveyRef.current = fresh;
                onSurveyChanged(fresh);
                recomputeChanges(creator);
            })
            .catch(() => undefined);
    }, [creator, onSurveyChanged, realtime.data, recomputeChanges, surveyId]);

    const otherEditors = useMemo(
        () => Object.values(presence).filter((entry) => Date.now() - new Date(entry.at).getTime() < 90000),
        [presence],
    );

    if (fatalError) {
        return (
            <Alert color="red" title="Survey editor">
                {fatalError}
            </Alert>
        );
    }
    if (!bridge || !creator) {
        return (
            <Group gap="xs" justify="center" py="xl">
                <Loader size="sm" />
                <Text>Loading the survey editor…</Text>
            </Group>
        );
    }

    const hasUnpublished = changeCount > 0;
    const Component = bridge.SurveyCreatorComponent;
    return (
        <Stack gap="sm">
            <Paper withBorder p="sm" className="surveyjs-designer-toolbar">
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                    <Group gap="xs" aria-live="polite">
                        {survey.currentRevision ? (
                            <Badge color="green" variant="light">Published v{survey.currentRevision}</Badge>
                        ) : (
                            <Badge color="yellow" variant="light">Not published yet</Badge>
                        )}
                        {hasUnpublished && (
                            <Tooltip label="Changes since the last published version; participants do not see them yet">
                                <Badge color="orange" variant="light">
                                    {changeCount} unpublished {changeCount === 1 ? 'change' : 'changes'}
                                </Badge>
                            </Tooltip>
                        )}
                        {dirty ? (
                            <Text size="sm" c="orange">Unsaved changes</Text>
                        ) : survey.draftUpdatedAt ? (
                            <Text size="sm" c="dimmed">Draft saved {new Date(survey.draftUpdatedAt).toLocaleString()}</Text>
                        ) : null}
                    </Group>
                    <Group gap="xs">
                        {canEdit && (
                            <Button variant="default" onClick={() => void save()} loading={busy === 'save'} disabled={(!dirty && !jsonTabEdited) || busy !== null}>
                                Save draft
                            </Button>
                        )}
                        {canPublish && (
                            <Tooltip label={hasUnpublished ? 'Participants get this version from now on' : 'Nothing to publish'}>
                                <Button onClick={() => void publish()} loading={busy === 'publish'} disabled={(!hasUnpublished && !jsonTabEdited) || busy !== null}>
                                    Publish
                                </Button>
                            </Tooltip>
                        )}
                    </Group>
                </Group>
            </Paper>
            {!canEdit && (
                <Alert color="gray">You can look at this survey but not change it.</Alert>
            )}
            {conflict && (
                <Alert color="yellow" title={conflict.action === 'save' ? 'Could not save' : 'Could not publish'}>
                    <Stack gap="xs">
                        <Text size="sm">{conflict.message}</Text>
                        <Group gap="xs">
                            <Button size="xs" variant="default" onClick={() => void loadTheirVersion()}>
                                Load the saved version
                            </Button>
                            <Button
                                size="xs"
                                color="orange"
                                variant="light"
                                onClick={() => void (conflict.action === 'save' ? save(true) : publish(true))}
                            >
                                {conflict.action === 'save' ? 'Overwrite with my version' : 'Publish my version anyway'}
                            </Button>
                        </Group>
                    </Stack>
                </Alert>
            )}
            {remoteDraft === 'loaded' && (
                <Alert color="blue" withCloseButton onClose={() => setRemoteDraft(null)} role="status">
                    A newer draft was saved in another window or by another editor. The editor now shows it.
                </Alert>
            )}
            {remoteDraft === 'held' && !conflict && (
                <Alert color="yellow" title="A newer draft was saved elsewhere" withCloseButton onClose={() => setRemoteDraft(null)}>
                    <Stack gap="xs">
                        <Text size="sm">
                            It was saved in another window or by another editor while you have unsaved changes here.
                            Saving asks before it overwrites that draft.
                        </Text>
                        <Group gap="xs">
                            <Button size="xs" variant="default" onClick={() => void loadTheirVersion()}>
                                Load the saved version
                            </Button>
                        </Group>
                    </Stack>
                </Alert>
            )}
            {otherEditors.length > 0 && (
                <Alert color="yellow" title="Someone else is editing this survey">
                    {otherEditors.map((editor) => editor.name).join(', ')} also {otherEditors.length === 1 ? 'has' : 'have'} it
                    open. Saving checks that you do not overwrite their changes.
                </Alert>
            )}
            {jsonTabNote && (
                <Alert color="yellow" title="Check your changes in the Designer tab" withCloseButton onClose={() => setJsonTabNote(false)}>
                    Changes made in the JSON Editor are taken into the survey when you open the Designer tab. Open it, check
                    the survey, then save or publish.
                </Alert>
            )}
            {actionError && (
                <Alert color="red" title="Survey editor" withCloseButton onClose={() => setActionError(null)}>
                    {actionError}
                </Alert>
            )}
            <Paper withBorder p={0} className="surveyjs-creator-shell">
                <Component creator={creator} />
            </Paper>
        </Stack>
    );
}

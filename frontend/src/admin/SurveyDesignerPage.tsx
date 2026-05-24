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

import { useEffect, useState } from 'react';
import { Alert, Loader, Paper, Stack, Text, Title } from '@mantine/core';

import { fetchLicenseKey, getSurvey, publishVersion, type IAdminSurveyDetail } from '../api/surveys-admin';
import { buildCreatorTheme, buildSurveyJsTheme } from '../theme/mantineBridge';
import { getPluginApi } from '../runtime/pluginApi';
import { isRichTextEditorEnabled, registerTiptapPropertyEditors } from '../creator/richTextEditorAdapter';

interface ICreatorBridge {
    SurveyCreatorComponent: React.ComponentType<{ creator: unknown }>;
    SurveyCreator: new (options: Record<string, unknown>) => unknown;
    rawModule: Record<string, unknown>;
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
}

export function SurveyDesignerPage({ surveyId }: ISurveyDesignerPageProps = {}): React.ReactElement {
    const [bridge, setBridge] = useState<ICreatorBridge | null>(null);
    const [survey, setSurvey] = useState<IAdminSurveyDetail | null>(null);
    const [creator, setCreator] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadCreator().then((b) => {
            if (!cancelled) setBridge(b);
        }).catch((err: Error) => setError(`Creator failed to load: ${err.message}`));
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!surveyId) return;
        let cancelled = false;
        getSurvey(surveyId).then((data) => {
            if (!cancelled) setSurvey(data);
        }).catch((err: Error) => setError(`Failed to load survey: ${err.message}`));
        return () => { cancelled = true; };
    }, [surveyId]);

    useEffect(() => {
        if (!bridge) return;
        let cancelled = false;
        const init = async (): Promise<void> => {
            const license = await fetchLicenseKey().catch(() => ({ licenseKey: null, configured: false }));
            if (cancelled) return;
            const options: Record<string, unknown> = {
                showLogicTab: true,
                isAutoSave: false,
                showThemeTab: true,
                showJSONEditorTab: true,
            };
            if (license.licenseKey) {
                options.licenseKey = license.licenseKey;
            }
            const instance = new bridge.SurveyCreator(options);
            const themeCode = survey?.themeCode ?? 'default';
            (instance as {
                applyTheme: (theme: Record<string, unknown>) => void;
            }).applyTheme(buildSurveyJsTheme(themeCode));
            // Match the Creator chrome to the Mantine palette. Fail
            // open if the API isn't present (older Creator builds), so
            // the Designer still renders with SurveyJS defaults.
            const applyCreatorTheme = (instance as {
                applyCreatorTheme?: (theme: Record<string, unknown>) => void;
            }).applyCreatorTheme;
            if (typeof applyCreatorTheme === 'function') {
                applyCreatorTheme.call(instance, buildCreatorTheme(themeCode));
            }

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
                    await publishVersion(surveyId, json);
                    success(true);
                } catch (err) {
                    setError(`Save failed: ${(err as Error).message}`);
                    success(false);
                }
            };
            (instance as { saveSurveyFunc: typeof saveHandler }).saveSurveyFunc = saveHandler;
            setCreator(instance);
        };
        void init();
        return () => { cancelled = true; };
    }, [bridge, survey, surveyId]);

    if (error) {
        return (
            <Alert color="red" title="Survey Designer">
                {error}
            </Alert>
        );
    }
    if (!surveyId) {
        return (
            <Paper withBorder p="md">
                <Stack gap="xs">
                    <Title order={3}>Survey Designer</Title>
                    <Text c="dimmed">Select a survey from the list to start designing.</Text>
                </Stack>
            </Paper>
        );
    }
    if (!bridge || !creator) {
        return (
            <Paper withBorder p="md">
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
        <Paper withBorder p={0} className="surveyjs-creator-shell">
            <Component creator={creator} />
        </Paper>
    );
}

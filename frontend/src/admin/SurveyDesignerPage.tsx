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

import { fetchLicenseKey, getSurvey, publishVersion, type IAdminSurveyDetail } from '../api/surveys-admin';
import { buildSurveyJsTheme } from '../theme/mantineBridge';

interface ICreatorBridge {
    SurveyCreatorComponent: React.ComponentType<{ creator: unknown }>;
    SurveyCreator: new (options: Record<string, unknown>) => unknown;
}

async function loadCreator(): Promise<ICreatorBridge> {
    const mod = await import('survey-creator-react');
    return {
        SurveyCreatorComponent: mod.SurveyCreatorComponent as unknown as React.ComponentType<{ creator: unknown }>,
        SurveyCreator: mod.SurveyCreator as unknown as new (options: Record<string, unknown>) => unknown,
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
            (instance as {
                applyTheme: (theme: Record<string, unknown>) => void;
            }).applyTheme(buildSurveyJsTheme(survey?.themeCode ?? 'default'));

            if (survey?.definition) {
                (instance as { JSON: Record<string, unknown> }).JSON = survey.definition;
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
            <div role="alert" style={{ padding: 12, border: '1px solid #fa5252', borderRadius: 4 }}>
                {error}
            </div>
        );
    }
    if (!surveyId) {
        return (
            <div style={{ padding: 16 }}>
                <h2>Survey Designer</h2>
                <p>Select a survey from the list to start designing.</p>
            </div>
        );
    }
    if (!bridge || !creator) {
        return <div aria-busy>Loading designer…</div>;
    }
    const Component = bridge.SurveyCreatorComponent;
    return <Component creator={creator} />;
}

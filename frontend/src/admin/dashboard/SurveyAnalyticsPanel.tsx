/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Charts per question for the Answers tab: the SurveyJS Dashboard
 * (`survey-analytics`, commercial), which draws with Chart.js. Loaded only
 * when the tab opens. The raw answers are in the core data screen.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Code, Stack, Text } from '@mantine/core';

import { fetchLicenseKey } from '../../api/surveys-admin';
import type { IDashboardResults } from '../../api/surveys-admin';

interface IAnalyticsBridge {
    Model: new (definition: unknown) => unknown;
    setLicenseKey: (key: string) => void;
    VisualizationPanel: new (
        questions: Array<unknown>,
        data: Array<Record<string, unknown>>,
        options?: Record<string, unknown>,
    ) => {
        render: (element: HTMLElement) => void;
        destroy: () => void;
    };
}

async function loadAnalytics(): Promise<IAnalyticsBridge | null> {
    try {
        const [core, analytics] = await Promise.all([
            import('survey-core'),
            import('survey-analytics'),
        ]);
        return {
            Model: (core as unknown as IAnalyticsBridge).Model,
            setLicenseKey: (core as unknown as IAnalyticsBridge).setLicenseKey,
            VisualizationPanel: (analytics as unknown as IAnalyticsBridge).VisualizationPanel,
        };
    } catch {
        return null;
    }
}

export interface ISurveyAnalyticsPanelProps {
    results: IDashboardResults;
}

export function SurveyAnalyticsPanel({ results }: ISurveyAnalyticsPanelProps): React.ReactElement {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [bridge, setBridge] = useState<IAnalyticsBridge | null>(null);
    const [bridgeMissing, setBridgeMissing] = useState<boolean>(false);
    const [licenseConfigured, setLicenseConfigured] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([
            loadAnalytics(),
            fetchLicenseKey().catch(() => ({ licenseKey: null, configured: false })),
        ]).then(([b, license]) => {
            if (cancelled) return;
            if (b === null) {
                setBridgeMissing(true);
                return;
            }
            setLicenseConfigured(Boolean(license.configured));
            if (license.licenseKey) {
                b.setLicenseKey(license.licenseKey);
            }
            setBridge(b);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!bridge || !containerRef.current || licenseConfigured !== true) return;
        const surveyModel = new bridge.Model(results.definition) as { getAllQuestions: () => Array<unknown> };
        const panel = new bridge.VisualizationPanel(
            surveyModel.getAllQuestions(),
            results.rows,
            { showHeader: true, allowDynamicLayout: true },
        );
        panel.render(containerRef.current);
        return () => panel.destroy();
    }, [bridge, results, licenseConfigured]);

    if (bridgeMissing) {
        return (
            <Alert color="yellow" title="Charts package not installed">
                <Stack gap="xs">
                    <Text size="sm">
                        Install <Code>survey-analytics</Code> (commercial) to show charts per question. The
                        answers themselves are in the Data screen.
                    </Text>
                </Stack>
            </Alert>
        );
    }
    if (licenseConfigured === false) {
        return (
            <Alert color="yellow" title="SurveyJS Dashboard license not configured">
                <Stack gap="xs">
                    <Text size="sm">
                        The charts view uses <Code>survey-analytics</Code>, which requires a SurveyJS
                        developer license. Configure <Code>SURVEYJS_LICENSE_KEY</Code> in the backend
                        environment to enable charts.
                    </Text>
                </Stack>
            </Alert>
        );
    }
    // The two classes are SurveyJS's theme root: they give the charts the
    // design tokens that `theme/mantine-adapter.css` points at Mantine.
    return (
        <div ref={containerRef} className="sd-theme-root sjs-theme-overrides" style={{ minHeight: 320 }} />
    );
}

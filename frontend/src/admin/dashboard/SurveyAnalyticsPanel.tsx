/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * SurveyJS Analytics chart panel for the Dashboard tab.
 *
 * Lazily imports `survey-analytics` (commercial) and renders one
 * visualizer per question. When the package isn't installed we
 * display a notice — the Tabulator-backed table still gives the
 * operator full access to the raw data.
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
                        Install <Code>survey-analytics</Code> (commercial) to enable per-question chart
                        visualizations. The table tab still gives full access to the response data.
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
    return (
        <div ref={containerRef} style={{ minHeight: 320 }} />
    );
}

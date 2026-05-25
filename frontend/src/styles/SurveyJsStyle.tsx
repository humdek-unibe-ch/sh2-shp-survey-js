/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `surveyjs` runtime style.
 *
 * Reads the selected survey id/key from the section field map, fetches the
 * published definition from
 * `/api/plugins/sh2-shp-survey-js/published/{key}`, and renders
 * it through `survey-react-ui`. On submit it posts the answers to the
 * matching `/submit` endpoint.
 *
 * The Mantine theme bridge in `theme/mantineBridge.ts` produces the
 * SurveyJS theme JSON applied to the runtime Model.
 *
 * SurveyJS modules (`survey-core`, `survey-react-ui`) are loaded
 * lazily so the host shell does not pay for them when no survey is on
 * the page.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Loader, Stack, Text } from '@mantine/core';

import { buildSurveyJsTheme, useMantineLivePalette } from '../theme/mantineBridge';
import { fetchPublishedSurvey, submitSurveyAnswers, type IPublishedSurvey } from '../api/surveys';

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
    Model: new (definition: unknown) => unknown;
    applyTheme: (model: unknown, theme: Record<string, unknown>) => void;
    bindSubmit: (model: unknown, handler: (answers: Record<string, unknown>) => void) => void;
}

/**
 * Dynamically import the SurveyJS runtime ESM bundle. The host's
 * Webpack/Next config externalizes `survey-core` and `survey-react-ui`
 * to its own chunk so this never duplicates code across plugins.
 */
async function loadRuntime(): Promise<ISurveyRuntimeBridge> {
    const [core, ui] = await Promise.all([
        import('survey-core'),
        import('survey-react-ui'),
    ]);
    return {
        Survey: ui.Survey as unknown as React.ComponentType<{ model: unknown }>,
        Model: core.Model as unknown as new (definition: unknown) => unknown,
        applyTheme(model, theme) {
            (model as { applyTheme: (theme: Record<string, unknown>) => void }).applyTheme(theme);
        },
        bindSubmit(model, handler) {
            (model as {
                onComplete: { add: (cb: (sender: { data: Record<string, unknown> }) => void) => void };
            }).onComplete.add((sender) => handler(sender.data));
        },
    };
}

export function SurveyJsStyle({ style, section, styleProps, cssClass }: ISurveyJsStyleProps): React.ReactElement | null {
    const runtimeSection = section ?? style;
    const surveyIdentifier = useMemo(() => extractSurveyIdentifier(runtimeSection), [runtimeSection]);
    const configuredTheme = useMemo(() => extractFieldString(runtimeSection, 'survey-js-theme'), [runtimeSection]);
    const redirectAtEnd = useMemo(() => extractFieldString(runtimeSection, 'redirect_at_end'), [runtimeSection]);
    const [runtime, setRuntime] = useState<ISurveyRuntimeBridge | null>(null);
    const [published, setPublished] = useState<IPublishedSurvey | null>(null);
    const [model, setModel] = useState<unknown>(null);
    const [submittedAt, setSubmittedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const livePalette = useMantineLivePalette();

    useEffect(() => {
        let mounted = true;
        if (!surveyIdentifier) return;
        loadRuntime()
            .then((bridge) => {
                if (mounted) setRuntime(bridge);
            })
            .catch((err: Error) => setError(`SurveyJS runtime failed to load: ${err.message}`));
        fetchPublishedSurvey(surveyIdentifier)
            .then((data) => {
                if (mounted) setPublished(data);
            })
            .catch((err: Error) => setError(`Survey not available: ${err.message}`));
        return () => {
            mounted = false;
        };
    }, [surveyIdentifier]);

    useEffect(() => {
        if (!runtime || !published) return;
        const next = new runtime.Model(published.definition);
        runtime.applyTheme(
            next,
            buildSurveyJsTheme(configuredTheme ?? published.themeCode ?? 'default', livePalette),
        );
        runtime.bindSubmit(next, (answers) => {
            void submitSurveyAnswers(published.surveyId, answers)
                .then((result) => {
                    setSubmittedAt(result.submittedAt);
                    if (redirectAtEnd && typeof window !== 'undefined') {
                        window.location.assign(redirectAtEnd);
                    }
                })
                .catch((err: Error) => setError(`Survey submission failed: ${err.message}`));
        });
        setModel(next);
    }, [runtime, published, configuredTheme, redirectAtEnd, livePalette]);

    if (!surveyIdentifier) {
        return (
            <Alert color="yellow" title="Configuration error">
                The SurveyJS style is missing a selected survey on this section.
            </Alert>
        );
    }
    if (error) {
        return (
            <Alert color="red" title="Survey unavailable">
                {error}
            </Alert>
        );
    }
    if (!runtime || !published || !model) {
        return (
            <Stack align="center" gap="xs" py="md">
                <Loader size="md" />
                <Text>Loading survey…</Text>
            </Stack>
        );
    }
    if (submittedAt) {
        return (
            <Alert color="green" title="Response recorded">
                Thank you — your response was recorded at {submittedAt}.
            </Alert>
        );
    }
    const Survey = runtime.Survey;
    // Wrap in a Mantine `Box` so plugin authors and admins can target
    // `.surveyjs-runtime-host` from custom CSS, and the SurveyJS sizing
    // logic inherits the host page's container width.
    return (
        <Box className={['surveyjs-runtime-host', cssClass].filter(Boolean).join(' ')} {...styleProps}>
            <Survey model={model} />
        </Box>
    );
}

function extractSurveyIdentifier(section?: TPluginStyleSection): string | null {
    return extractFieldString(section, 'survey-js');
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

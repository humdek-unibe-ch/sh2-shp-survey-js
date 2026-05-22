/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `surveyjs` runtime style.
 *
 * Reads the survey `keySlug` from the section field map, fetches the
 * published definition from `/cms-api/v1/plugins/surveyjs/published/{key}`,
 * and renders it through `survey-react-ui`. On submit it posts the
 * answers to the matching `/submit` endpoint.
 *
 * The Mantine theme bridge in `theme/mantineBridge.ts` produces the
 * SurveyJS theme JSON applied to the runtime Model.
 *
 * SurveyJS modules (`survey-core`, `survey-react-ui`) are loaded
 * lazily so the host shell does not pay for them when no survey is on
 * the page.
 */

import { useEffect, useMemo, useState } from 'react';

import { buildSurveyJsTheme } from '../theme/mantineBridge';
import { fetchPublishedSurvey, submitSurveyAnswers, type IPublishedSurvey } from '../api/surveys';

export interface ISurveyJsStyleProps {
    section: {
        id: number;
        fields?: Record<string, unknown>;
        style_name?: string;
    };
    values?: Record<string, unknown>;
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

export function SurveyJsStyle({ section }: ISurveyJsStyleProps): React.ReactElement | null {
    const keySlug = useMemo(() => extractKeySlug(section), [section]);
    const [runtime, setRuntime] = useState<ISurveyRuntimeBridge | null>(null);
    const [published, setPublished] = useState<IPublishedSurvey | null>(null);
    const [model, setModel] = useState<unknown>(null);
    const [submittedAt, setSubmittedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        if (!keySlug) return;
        loadRuntime()
            .then((bridge) => {
                if (mounted) setRuntime(bridge);
            })
            .catch((err: Error) => setError(`SurveyJS runtime failed to load: ${err.message}`));
        fetchPublishedSurvey(keySlug)
            .then((data) => {
                if (mounted) setPublished(data);
            })
            .catch((err: Error) => setError(`Survey not available: ${err.message}`));
        return () => {
            mounted = false;
        };
    }, [keySlug]);

    useEffect(() => {
        if (!runtime || !published) return;
        const next = new runtime.Model(published.definition);
        runtime.applyTheme(next, buildSurveyJsTheme(published.themeCode ?? 'default'));
        runtime.bindSubmit(next, (answers) => {
            void submitSurveyAnswers(published.keySlug, answers).then((result) => {
                setSubmittedAt(result.submittedAt);
            });
        });
        setModel(next);
    }, [runtime, published]);

    if (!keySlug) {
        return (
            <div role="alert" style={{ padding: 12, border: '1px solid #fab005', borderRadius: 4 }}>
                The SurveyJS style is missing a <code>key_slug</code> field on this section.
            </div>
        );
    }
    if (error) {
        return (
            <div role="alert" style={{ padding: 12, border: '1px solid #fa5252', borderRadius: 4 }}>
                {error}
            </div>
        );
    }
    if (!runtime || !published || !model) {
        return <div aria-busy>Loading survey…</div>;
    }
    if (submittedAt) {
        return (
            <div role="status" style={{ padding: 12, border: '1px solid #51cf66', borderRadius: 4 }}>
                Thank you — your response was recorded at {submittedAt}.
            </div>
        );
    }
    const Survey = runtime.Survey;
    return <Survey model={model} />;
}

function extractKeySlug(section: ISurveyJsStyleProps['section']): string | null {
    const fields = section.fields ?? {};
    for (const key of ['key_slug', 'keySlug', 'survey_key']) {
        const value = fields[key];
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
        if (
            value &&
            typeof value === 'object' &&
            'content' in (value as Record<string, unknown>) &&
            typeof (value as { content?: unknown }).content === 'string'
        ) {
            return ((value as { content: string }).content ?? '').trim() || null;
        }
    }
    return null;
}

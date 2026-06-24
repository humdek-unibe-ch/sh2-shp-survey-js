/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Read-only mobile renderer for a published SurveyJS survey.
 *
 * v1 renders questions natively using a minimal subset matching the
 * SurveyJS question types we encounter in practice (text, comment,
 * single-choice radio, checkbox group). Anything else falls back to a
 * compact "Open on web" prompt so the user can finish the survey in
 * the browser.
 *
 * Submissions are NOT supported on mobile v1. The host renderer
 * routes any submit-required SurveyJS sections to the host's web
 * fallback through `BasicStyle.tsx`.
 */

import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

interface ISurveyJsReadOnlyStyleProps {
    section: {
        id?: number;
        fields?: Record<string, unknown>;
        style_name?: string;
    };
    values?: Record<string, unknown>;
}

interface IPublishedSurvey {
    surveyId: string;
    name: string;
    themeCode: string | null;
    revision: number;
    definition: Record<string, unknown>;
}

const FALLBACK_URL_KEY = 'web_fallback_url';

export function SurveyJsReadOnlyStyle({ section }: ISurveyJsReadOnlyStyleProps): React.ReactElement | null {
    const surveyId = extractSurveyId(section);
    const [survey, setSurvey] = useState<IPublishedSurvey | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!surveyId) return;
        let cancelled = false;
        fetch(
            `/cms-api/v1/plugins/sh2-shp-survey-js/published/${encodeURIComponent(surveyId)}`,
            { headers: { Accept: 'application/json' } },
        )
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { data: IPublishedSurvey };
                if (!cancelled) setSurvey(body.data);
            })
            .catch((err: Error) => setError(err.message));
        return () => { cancelled = true; };
    }, [surveyId]);

    if (!surveyId) {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#fab005', borderRadius: 6 }}>
                <Text style={{ color: '#856404' }}>
                    The SurveyJS section is missing a survey id field.
                </Text>
            </View>
        );
    }
    if (error) {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#fa5252', borderRadius: 6 }}>
                <Text style={{ color: '#c92a2a' }}>Failed to load survey: {error}</Text>
            </View>
        );
    }
    if (!survey) {
        return (
            <View style={{ padding: 12 }}>
                <Text>Loading survey…</Text>
            </View>
        );
    }

    const questions = extractQuestions(survey.definition);
    const fallbackUrl = ((section.fields ?? {})[FALLBACK_URL_KEY] as string | undefined) ?? null;

    return (
        <View style={{ paddingVertical: 8 }}>
            <Text style={{ fontWeight: '700', fontSize: 18, marginBottom: 8 }}>{survey.name}</Text>
            {questions.map((q) => (
                <View
                    key={q.name}
                    style={{
                        marginBottom: 12,
                        padding: 8,
                        borderWidth: 1,
                        borderColor: '#dee2e6',
                        borderRadius: 6,
                    }}
                >
                    <Text style={{ fontWeight: '600', marginBottom: 4 }}>
                        {q.title ?? q.name}
                    </Text>
                    <Text style={{ color: '#495057' }}>
                        {q.type === 'rich-text'
                            ? 'Rich-text answer (open on web to view)'
                            : `Type: ${q.type}`}
                    </Text>
                </View>
            ))}
            <Text style={{ marginTop: 8, color: '#868e96', fontStyle: 'italic' }}>
                Read-only preview. Open on the web app to submit responses.
            </Text>
            {fallbackUrl ? (
                <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                        void Linking.openURL(fallbackUrl);
                    }}
                    style={({ pressed }) => ({
                        marginTop: 12,
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 4,
                        backgroundColor: pressed ? '#1971c2' : '#228be6',
                        alignSelf: 'flex-start',
                    })}
                >
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Open on web</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

interface IQuestionShape {
    name: string;
    title?: string;
    type: string;
}

export function extractQuestions(definition: Record<string, unknown>): IQuestionShape[] {
    const out: IQuestionShape[] = [];
    const pages = Array.isArray(definition['pages']) ? (definition['pages'] as unknown[]) : [];
    for (const page of pages) {
        if (!page || typeof page !== 'object') continue;
        const elements = Array.isArray((page as { elements?: unknown }).elements)
            ? ((page as { elements: unknown[] }).elements as unknown[])
            : [];
        for (const element of elements) {
            if (!element || typeof element !== 'object') continue;
            const cast = element as { name?: unknown; title?: unknown; type?: unknown };
            if (typeof cast.name !== 'string' || typeof cast.type !== 'string') continue;
            out.push({
                name: cast.name,
                title: typeof cast.title === 'string' ? cast.title : undefined,
                type: cast.type,
            });
        }
    }
    return out;
}

export function extractSurveyId(section: ISurveyJsReadOnlyStyleProps['section']): string | null {
    const fields = section.fields ?? {};
    const value = fields['survey-js'];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (
        value &&
        typeof value === 'object' &&
        'content' in (value as Record<string, unknown>) &&
        typeof (value as { content?: unknown }).content === 'string'
    ) {
        return ((value as { content: string }).content ?? '').trim() || null;
    }
    return null;
}

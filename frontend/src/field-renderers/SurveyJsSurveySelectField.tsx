/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `select-survey-js` field-type editor.
 *
 * Contributed to the host CMS section-field editor through the plugin
 * SDK's `fieldRenderers` extension point (introduced in pluginApiVersion
 * 1.1). The host's `FieldRenderer` looks up the renderer by field type
 * and mounts this component for any field whose
 * `fields.type = 'select-survey-js'`. The migration in
 * `backend/src/Migrations/Version20260522063620.php` seeds the field type
 * and links it to the `survey-js` field on the `surveyjs` style.
 *
 * The picker hits the plugin's own admin API through the host's
 * Next.js BFF proxy (`/api/admin/plugins/sh2-shp-survey-js/surveys`),
 * which forwards to `/cms-api/v1/admin/plugins/sh2-shp-survey-js/surveys`
 * on the Symfony backend. The value persisted on the section field is
 * the generated public survey id (`SV_...`), which is also the public
 * runtime submission key.
 */

import { useEffect, useState } from 'react';
import { Select } from '@mantine/core';
import type { IPluginFieldRendererProps } from '@selfhelp/shared/plugin-sdk';

import { listSurveys, type IAdminSurveySummary } from '../api/surveys-admin';

export function SurveyJsSurveySelectField({
    fieldId,
    value,
    onChange,
    disabled,
}: IPluginFieldRendererProps): React.ReactElement {
    const [surveys, setSurveys] = useState<IAdminSurveySummary[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [localValue, setLocalValue] = useState<string>('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listSurveys()
            .then((data) => {
                if (cancelled) return;
                setSurveys(data);
                setError(null);
            })
            .catch((err: Error) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const selected = surveys.find((survey) => (
            survey.surveyId === value
        ));
        setLocalValue(selected ? selected.surveyId : '');
    }, [value, surveys]);

    return (
        <Select
            key={fieldId}
            data={surveys.map((survey) => ({
                value: survey.surveyId,
                label: `${survey.name} (${survey.surveyId})${survey.currentRevision ? ` · v${survey.currentRevision}` : ' · draft only'}`,
            }))}
            value={localValue}
            onChange={(next) => {
                const nextValue = next ?? '';
                setLocalValue(nextValue);
                onChange(nextValue);
            }}
            placeholder={error ? 'Could not load surveys' : 'Search and select a SurveyJS survey...'}
            searchable
            clearable
            disabled={disabled || loading}
            error={error ?? undefined}
            nothingFoundMessage={loading ? 'Loading surveys...' : 'No surveys found'}
        />
    );
}

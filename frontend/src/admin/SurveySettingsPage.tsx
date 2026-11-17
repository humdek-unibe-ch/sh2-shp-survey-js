/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Per-survey settings page.
 *
 * Plugin-wide configuration (license key, permissions, developer
 * runtime) is shown on the survey list page. This page intentionally
 * contains only settings that change the selected survey.
 */

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Code, Group, Loader, Stack, Text, TextInput, Title } from '@mantine/core';

import { getSurvey, updateSurvey, type IAdminSurveyDetail } from '../api/surveys-admin';

interface ISurveySettingsPageProps {
    surveyId: number;
    onSurveyChanged?: (survey: IAdminSurveyDetail) => void;
}

export function SurveySettingsPage({ surveyId, onSurveyChanged }: ISurveySettingsPageProps): React.ReactElement {
    const [survey, setSurvey] = useState<IAdminSurveyDetail | null>(null);
    const [name, setName] = useState<string>('');
    const [saving, setSaving] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getSurvey(surveyId)
            .then((data) => {
                if (cancelled) return;
                setSurvey(data);
                setName(data.name);
            })
            .catch((err: Error) => setError(err.message));
        return () => {
            cancelled = true;
        };
    }, [surveyId]);

    const save = async (): Promise<void> => {
        if (!survey) return;
        setSaving(true);
        setError(null);
        try {
            const updated = await updateSurvey(survey.id, { name: name.trim() });
            const detail = await getSurvey(updated.id);
            setSurvey(detail);
            setName(detail.name);
            onSurveyChanged?.(detail);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Stack gap="md">
            <Title order={4}>Survey settings</Title>

            <Card withBorder padding="lg">
                <Stack gap="sm">
                    <Title order={5}>Identity and public presentation</Title>
                    {survey === null ? (
                        <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="sm">Loading survey settings…</Text>
                        </Group>
                    ) : (
                        <>
                            <TextInput
                                label="Name"
                                value={name}
                                onChange={(event) => setName(event.currentTarget.value)}
                                disabled={saving}
                            />
                            <Text size="sm" c="dimmed">
                                Survey ID: <Code>{survey.surveyId}</Code>. It does not change when the survey is
                                renamed and is the value stored by the CMS survey selector.
                            </Text>
                            {error && (
                                <Alert color="red" title="Could not save settings">
                                    {error}
                                </Alert>
                            )}
                            <Group justify="flex-end">
                                <Button onClick={() => void save()} loading={saving} disabled={name.trim() === ''}>
                                    Save settings
                                </Button>
                            </Group>
                        </>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}

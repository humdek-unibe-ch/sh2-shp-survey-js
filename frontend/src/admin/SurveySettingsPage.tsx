/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Settings of one survey: its name and its stable survey ID. How a survey
 * behaves on a page (once per user, time window, texts…) is set on the
 * `surveyjs` section that places it, not here.
 */

import { useState } from 'react';
import { Alert, Button, Card, Code, Group, Stack, Text, TextInput, Title } from '@mantine/core';

import { getSurvey, updateSurvey, type IAdminSurveyDetail } from '../api/surveys-admin';

interface ISurveySettingsPageProps {
    survey: IAdminSurveyDetail;
    onSurveyChanged: (survey: IAdminSurveyDetail) => void;
}

export function SurveySettingsPage({ survey, onSurveyChanged }: ISurveySettingsPageProps): React.ReactElement {
    const [name, setName] = useState<string>(survey.name);
    const [saving, setSaving] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<boolean>(false);
    const canEdit = survey.rights.update;
    const trimmed = name.trim();

    const save = async (): Promise<void> => {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            await updateSurvey(survey.id, { name: trimmed });
            onSurveyChanged(await getSurvey(survey.id));
            setSaved(true);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card withBorder padding="lg" maw={720}>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (canEdit && trimmed !== '' && trimmed !== survey.name) void save();
                }}
            >
                <Stack gap="sm">
                    <Title order={2} size="h4">Survey settings</Title>
                    <TextInput
                        label="Name"
                        description="Shown to editors in the survey list and the section's survey picker. Participants see the survey's own title."
                        value={name}
                        onChange={(event) => {
                            setName(event.currentTarget.value);
                            setSaved(false);
                        }}
                        disabled={saving || !canEdit}
                        error={canEdit && trimmed === '' ? 'Enter a name.' : undefined}
                        required
                    />
                    <Text size="sm" c="dimmed">
                        Survey ID: <Code>{survey.surveyId}</Code>. It never changes, also when the survey is
                        renamed; sections store this ID.
                    </Text>
                    <Text size="sm" c="dimmed">
                        How the survey behaves on a page (once per user, time window, texts, redirect) is
                        set on the SurveyJS section that places it.
                    </Text>
                    {!canEdit && (
                        <Alert color="gray">You can view this survey but not change it.</Alert>
                    )}
                    {error && (
                        <Alert color="red" title="Could not save the settings">
                            {error}
                        </Alert>
                    )}
                    {saved && (
                        <Text size="sm" c="teal" role="status">
                            Saved.
                        </Text>
                    )}
                    {canEdit && (
                        <Group justify="flex-end">
                            <Button type="submit" loading={saving} disabled={trimmed === '' || trimmed === survey.name}>
                                Save
                            </Button>
                        </Group>
                    )}
                </Stack>
            </form>
        </Card>
    );
}

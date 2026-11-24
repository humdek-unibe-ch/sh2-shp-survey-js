/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * One response drawn as the survey, read-only, with the version it was given
 * with, and a link to its PDF. The list of responses is the core data
 * screen's; an editor finds a record ID there and opens it here.
 */

import { useEffect, useState } from 'react';
import { ActionIcon, Alert, Badge, Box, Button, Card, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconDownload, IconX } from '@tabler/icons-react';

import { fetchResponseDetail, getVersion, listVersions, type ISurveyResponseSummary } from '../api/surveys-admin';
import { applyMantineSurveyDefaults } from '../theme/surveyDefaults';
import { registerCustomQuestions } from '../custom-questions/register';
import { getPluginApi } from '../runtime/pluginApi';
import { applyStorageSettings } from '../runtime/storageSettings';

interface IViewState {
    response: ISurveyResponseSummary;
    Survey: React.ComponentType<{ model: unknown }>;
    model: unknown;
}

interface ISurveyResponseViewProps {
    surveyId: number;
    /** Record ID (digits) or response ID. */
    responseRef: string;
    /** Definition to fall back on when the response's version is unknown. */
    fallbackDefinition: Record<string, unknown> | null;
    onClose: () => void;
}

export function SurveyResponseView({ surveyId, responseRef, fallbackDefinition, onClose }: ISurveyResponseViewProps): React.ReactElement {
    const [view, setView] = useState<IViewState | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setView(null);
        setError(null);
        (async () => {
            const [detail, versions, core, ui] = await Promise.all([
                fetchResponseDetail(surveyId, responseRef),
                listVersions(surveyId),
                import('survey-core'),
                import('survey-react-ui'),
            ]);
            const version = versions.find((candidate) => candidate.revision === detail.revision);
            const definition = version ? (await getVersion(surveyId, version.id)).definition : fallbackDefinition;
            if (!definition) {
                throw new Error('The survey version of this response could not be found.');
            }
            applyMantineSurveyDefaults(core.Serializer);
            applyStorageSettings(core);
            const pluginApi = getPluginApi();
            const flag = (key: string, fallback: boolean): boolean => {
                try {
                    return pluginApi?.isFeatureEnabled(key) ?? fallback;
                } catch {
                    return fallback;
                }
            };
            await registerCustomQuestions({
                flags: { gpx: flag('gpx', false), video: flag('video', false), microphone: flag('microphone', false), richText: flag('rich-text', true) },
                richTextEditor: pluginApi?.richTextEditor ?? null,
            });
            const model = new core.Model(definition);
            model.readOnly = true;
            model.questionsOnPageMode = 'singlePage';
            model.data = detail.answers;
            if (!cancelled) {
                setView({ response: detail, Survey: ui.Survey as unknown as React.ComponentType<{ model: unknown }>, model });
            }
        })().catch((err: Error) => {
            if (!cancelled) setError(err.message);
        });
        return () => {
            cancelled = true;
        };
    }, [fallbackDefinition, responseRef, surveyId]);

    const header = (
        <Group justify="space-between" align="center">
            <Title order={3} size="h5">
                Response {view ? view.response.responseId : responseRef}
            </Title>
            <Group gap="xs">
                {view && (
                    <Button
                        component="a"
                        href={`/api/admin/plugins/sh2-shp-survey-js/surveys/${surveyId}/responses/${encodeURIComponent(view.response.responseId)}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="light"
                        size="xs"
                        leftSection={<IconDownload size={14} />}
                    >
                        PDF
                    </Button>
                )}
                <Tooltip label="Close">
                    <ActionIcon variant="subtle" color="gray" onClick={onClose} aria-label="Close the response">
                        <IconX size={16} />
                    </ActionIcon>
                </Tooltip>
            </Group>
        </Group>
    );

    return (
        <Card withBorder padding="lg">
            <Stack gap="sm">
                {header}
                {error ? (
                    <Alert color="red" title="Could not open the response">
                        {error}
                    </Alert>
                ) : view === null ? (
                    <Group gap="xs" justify="center" py="md">
                        <Loader size="sm" />
                        <Text size="sm">Loading the response…</Text>
                    </Group>
                ) : (
                    <>
                        <Group gap="xs">
                            <Badge variant="light" color={view.response.finished ? 'green' : 'yellow'}>
                                {view.response.finished ? 'Finished' : 'Not finished'}
                            </Badge>
                            <Badge variant="light" color="gray">Record {view.response.id}</Badge>
                            {view.response.revision !== null && <Badge variant="light">v{view.response.revision}</Badge>}
                            <Text size="sm" c="dimmed">
                                {view.response.userName ?? (view.response.userId === null ? 'Guest' : `User #${view.response.userId}`)}
                                {view.response.lastSavedAt ? ` · last saved ${new Date(view.response.lastSavedAt).toLocaleString()}` : ''}
                            </Text>
                        </Group>
                        <Box className="surveyjs-runtime-host">
                            <view.Survey model={view.model} />
                        </Box>
                    </>
                )}
            </Stack>
        </Card>
    );
}

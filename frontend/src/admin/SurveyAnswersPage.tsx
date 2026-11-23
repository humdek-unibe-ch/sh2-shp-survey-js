/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The Answers tab: how many responses, charts per question, and one response
 * drawn as the survey. Listing, filtering, exporting and deleting answers is
 * the core data screen's, linked from here. Everything needs the grant on the
 * survey's data table; new responses arrive over the
 * `surveys/{surveyId}/responses` realtime topic, without polling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Anchor, Button, Card, Group, Loader, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { usePluginRealtime } from '@selfhelp/shared/plugin-sdk';

import { fetchDashboard, fetchDashboardResults, type IAdminSurveyDetail, type IDashboardResults } from '../api/surveys-admin';
import { SurveyAnalyticsPanel } from './dashboard/SurveyAnalyticsPanel';
import { SurveyResponseView } from './SurveyResponseView';
import { dataScreenUrl } from './dataScreenUrl';

interface ICounts {
    finished: number;
    total: number;
}

interface ISurveyAnswersPageProps {
    survey: IAdminSurveyDetail;
}

export function SurveyAnswersPage({ survey }: ISurveyAnswersPageProps): React.ReactElement {
    const canRead = survey.responseCount !== null;
    const [counts, setCounts] = useState<ICounts | null>(null);
    const [results, setResults] = useState<IDashboardResults | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lookup, setLookup] = useState<string>('');
    const [openResponse, setOpenResponse] = useState<string | null>(null);

    const realtime = usePluginRealtime<{ type: string }>({
        pluginId: 'sh2-shp-survey-js',
        topic: 'surveys/{surveyId}/responses',
        topicParams: { surveyId: String(survey.id) },
        enabled: canRead,
    });

    const reload = useCallback(async (): Promise<void> => {
        setError(null);
        try {
            const [summary, rows] = await Promise.all([fetchDashboard(survey.id), fetchDashboardResults(survey.id, { limit: 5000 })]);
            setCounts({ finished: summary.completedResponses, total: summary.totalResponses });
            setResults(rows);
        } catch (err) {
            setError((err as Error).message);
        }
    }, [survey.id]);

    useEffect(() => {
        if (canRead) void reload();
    }, [canRead, reload]);

    useEffect(() => {
        if (realtime.data?.type === 'response_submitted') void reload();
    }, [realtime.data, reload]);

    if (!canRead) {
        return (
            <Alert color="gray" title="No access to the answers">
                Seeing a survey&apos;s answers needs the view grant on its data table. Ask an administrator to
                grant it to one of your roles.
            </Alert>
        );
    }

    return (
        <Stack gap="md">
            <Stack gap={2}>
                <Title order={2} size="h4">Answers</Title>
                <Text size="sm" c="dimmed">
                    Charts of the finished responses. To list, filter, export or delete answers, use
                    {survey.dataTableId !== null ? (
                        <>
                            {' '}
                            <Anchor href={dataScreenUrl(survey.dataTableId)} inherit>the Data screen</Anchor>.
                        </>
                    ) : ' the Data screen once the first response is in.'}
                </Text>
            </Stack>

            {error && (
                <Alert color="red" title="Could not load the answers">
                    {error}
                </Alert>
            )}

            {counts === null || results === null ? (
                !error && (
                    <Group gap="xs" justify="center" py="md">
                        <Loader size="sm" />
                        <Text>Loading the answers…</Text>
                    </Group>
                )
            ) : (
                <>
                    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                        <CountCard label="Finished" value={counts.finished} />
                        <CountCard label="Started, not finished" value={counts.total - counts.finished} />
                        <CountCard label="Published version" value={survey.currentRevision === null ? '—' : `v${survey.currentRevision}`} />
                    </SimpleGrid>

                    {counts.total > 0 && (
                    <Card withBorder padding="lg">
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (lookup.trim() !== '') setOpenResponse(lookup.trim());
                            }}
                        >
                            <Group align="flex-end" gap="sm" wrap="wrap">
                                <TextInput
                                    label="Look at one response"
                                    description="The record ID from the Data screen, or the response ID."
                                    value={lookup}
                                    onChange={(event) => setLookup(event.currentTarget.value)}
                                    style={{ flex: 1, minWidth: 220 }}
                                />
                                <Button type="submit" variant="default" leftSection={<IconEye size={16} />} disabled={lookup.trim() === ''}>
                                    Show
                                </Button>
                            </Group>
                        </form>
                    </Card>
                    )}

                    {openResponse !== null && (
                        <SurveyResponseView
                            key={openResponse}
                            surveyId={survey.id}
                            responseRef={openResponse}
                            fallbackDefinition={survey.publishedDefinition ?? null}
                            onClose={() => setOpenResponse(null)}
                        />
                    )}

                    {counts.finished === 0 ? (
                        <Alert color="gray" title="No finished responses yet">
                            Charts appear here once participants have submitted the survey.
                        </Alert>
                    ) : (
                        <SurveyAnalyticsPanel results={results} />
                    )}
                </>
            )}
        </Stack>
    );
}

function CountCard({ label, value }: { label: string; value: number | string }): React.ReactElement {
    return (
        <Card withBorder padding="lg">
            <Stack gap={4}>
                <Text c="dimmed" size="sm" tt="uppercase" fw={700}>
                    {label}
                </Text>
                <Text size="xl" fw={700}>
                    {typeof value === 'number' ? value.toLocaleString() : value}
                </Text>
            </Stack>
        </Card>
    );
}

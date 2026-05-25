/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey dashboard.
 *
 * Mirrors the legacy plugin's two-tab dashboard: a Tabulator-backed
 * "Table" view that lists every response (sortable, filterable,
 * exportable) and a "Dashboard" tab that hosts the SurveyAnalytics
 * `VisualizationPanel` for per-question charts. A small header card
 * still surfaces the headline counts so operators have an immediate
 * answer to "how many responses do I have?" without scrolling.
 *
 * Realtime updates: subscribes to `surveys/{surveyId}/responses` so
 * new rows appear without polling. Filters / search / column layout
 * persist to localStorage via the table panel.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Card,
    Group,
    Loader,
    Menu,
    SimpleGrid,
    Stack,
    Tabs,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import {
    IconChartBar,
    IconDownload,
    IconRefresh,
    IconTable,
} from '@tabler/icons-react';
import { usePluginRealtime } from '@selfhelp/shared/plugin-sdk';

import {
    buildResponsesExportUrl,
    fetchDashboard,
    fetchDashboardResults,
    type IDashboardResults,
} from '../api/surveys-admin';
import { SurveyResultsTable } from './dashboard/SurveyResultsTable';
import { SurveyAnalyticsPanel } from './dashboard/SurveyAnalyticsPanel';

interface IDashboardSummary {
    id: number;
    surveyId: string;
    completedResponses: number;
    totalResponses: number;
    currentVersionRevision: number | null;
}

export interface ISurveyDashboardPageProps {
    surveyId?: number;
}

export function SurveyDashboardPage({ surveyId }: ISurveyDashboardPageProps = {}): React.ReactElement {
    const [summary, setSummary] = useState<IDashboardSummary | null>(null);
    const [results, setResults] = useState<IDashboardResults | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string | null>('table');

    const realtime = usePluginRealtime<{ type: string }>({
        pluginId: 'sh2-shp-survey-js',
        topic: 'surveys/{surveyId}/responses',
        topicParams: summary ? { surveyId: String(summary.id) } : {},
        enabled: Boolean(summary),
    });

    const reload = useCallback(async (): Promise<void> => {
        if (!surveyId) return;
        setBusy(true);
        setError(null);
        try {
            const [summaryData, resultsData] = await Promise.all([
                fetchDashboard(surveyId),
                fetchDashboardResults(surveyId, { limit: 5000 }),
            ]);
            setSummary({
                id: summaryData.id,
                surveyId: summaryData.surveyId,
                completedResponses: summaryData.completedResponses,
                totalResponses: summaryData.totalResponses,
                currentVersionRevision: summaryData.currentVersionRevision,
            });
            setResults(resultsData);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Realtime: when a new response arrives, refresh the data.
    useEffect(() => {
        if (realtime.data?.type === 'response_submitted') {
            void reload();
        }
    }, [realtime.data, reload]);

    const exportLinks = useMemo(() => {
        if (!surveyId) return null;
        return {
            csv: buildResponsesExportUrl(surveyId, 'csv'),
            xlsx: buildResponsesExportUrl(surveyId, 'xlsx'),
            json: buildResponsesExportUrl(surveyId, 'json'),
        };
    }, [surveyId]);

    if (!surveyId) {
        return (
            <Card withBorder p="lg">
                <Stack gap="xs" align="center">
                    <IconChartBar size={32} />
                    <Title order={4}>No survey selected</Title>
                    <Text c="dimmed" size="sm">
                        Pick a survey from the list to see its dashboard.
                    </Text>
                </Stack>
            </Card>
        );
    }
    if (error) {
        return (
            <Alert color="red" title="Could not load dashboard">
                {error}
            </Alert>
        );
    }
    if (!summary || !results) {
        return (
            <Group gap="xs" justify="center" py="md">
                <Loader size="sm" />
                <Text>Loading dashboard…</Text>
            </Group>
        );
    }

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Title order={4}>Dashboard</Title>
                <Group gap="xs">
                    {realtime.error ? (
                        <Badge color="yellow" variant="light">Realtime offline</Badge>
                    ) : (
                        <Badge color="green" variant="light">Realtime live</Badge>
                    )}
                    <Tooltip label="Reload">
                        <ActionIcon
                            variant="subtle"
                            onClick={() => void reload()}
                            loading={busy}
                            aria-label="Reload"
                        >
                            <IconRefresh size={16} />
                        </ActionIcon>
                    </Tooltip>
                    {exportLinks !== null && (
                        <Menu shadow="md" withinPortal>
                            <Menu.Target>
                                <Button leftSection={<IconDownload size={16} />} variant="light">
                                    Export
                                </Button>
                            </Menu.Target>
                            <Menu.Dropdown>
                                <Menu.Item component="a" href={exportLinks.csv} target="_blank" rel="noopener noreferrer">
                                    CSV
                                </Menu.Item>
                                <Menu.Item component="a" href={exportLinks.xlsx} target="_blank" rel="noopener noreferrer">
                                    Excel (XLSX)
                                </Menu.Item>
                                <Menu.Item component="a" href={exportLinks.json} target="_blank" rel="noopener noreferrer">
                                    JSON
                                </Menu.Item>
                            </Menu.Dropdown>
                        </Menu>
                    )}
                </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                <SummaryCard label="Completed responses" value={summary.completedResponses} />
                <SummaryCard label="Total responses" value={summary.totalResponses} />
                <SummaryCard
                    label="Current revision"
                    value={summary.currentVersionRevision === null ? '—' : `v${summary.currentVersionRevision}`}
                />
            </SimpleGrid>

            <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
                <Tabs.List>
                    <Tabs.Tab value="table" leftSection={<IconTable size={14} />}>
                        Table
                    </Tabs.Tab>
                    <Tabs.Tab value="charts" leftSection={<IconChartBar size={14} />}>
                        Charts
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="table" pt="md">
                    <SurveyResultsTable surveyId={surveyId} results={results} />
                </Tabs.Panel>
                <Tabs.Panel value="charts" pt="md">
                    <SurveyAnalyticsPanel results={results} />
                </Tabs.Panel>
            </Tabs>
        </Stack>
    );
}

function SummaryCard({ label, value }: { label: string; value: number | string }): React.ReactElement {
    return (
        <Card withBorder padding="lg">
            <Stack gap={4}>
                <Text c="dimmed" size="sm" tt="uppercase">
                    {label}
                </Text>
                <Text size="xl" fw={700}>
                    {typeof value === 'number' ? value.toLocaleString() : value}
                </Text>
            </Stack>
        </Card>
    );
}

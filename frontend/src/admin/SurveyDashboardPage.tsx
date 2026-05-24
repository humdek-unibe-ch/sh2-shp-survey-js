/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey dashboard.
 *
 * Renders inside the unified `SurveyAdminPage` host shell as the
 * "Dashboard" tab. Surfaces the headline numbers from
 * `SurveyDashboardService::buildSummary()` and a compact recent-runs
 * list. Charts are intentionally deferred until the host's Mantine
 * Charts adapter lands; this page proves the data shape end-to-end.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Card,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { IconChartBar, IconRefresh } from '@tabler/icons-react';

import { fetchDashboard } from '../api/surveys-admin';

interface IDashboardSummary {
    surveyId: number;
    completedResponses: number;
    currentVersionRevision: number | null;
    recent: Array<{ id: number; startedAt: string; status: string }>;
}

export interface ISurveyDashboardPageProps {
    surveyId?: number;
}

export function SurveyDashboardPage({ surveyId }: ISurveyDashboardPageProps = {}): React.ReactElement {
    const [summary, setSummary] = useState<IDashboardSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);

    const reload = useCallback(async (): Promise<void> => {
        if (!surveyId) return;
        setBusy(true);
        setError(null);
        try {
            const data = await fetchDashboard(surveyId);
            setSummary(data);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

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
    if (!summary) {
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
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Card withBorder padding="lg">
                    <Stack gap={4}>
                        <Text c="dimmed" size="sm" tt="uppercase">
                            Completed responses
                        </Text>
                        <Text size="xl" fw={700}>
                            {summary.completedResponses.toLocaleString()}
                        </Text>
                    </Stack>
                </Card>
                <Card withBorder padding="lg">
                    <Stack gap={4}>
                        <Text c="dimmed" size="sm" tt="uppercase">
                            Current revision
                        </Text>
                        <Text size="xl" fw={700}>
                            {summary.currentVersionRevision === null
                                ? '—'
                                : `v${summary.currentVersionRevision}`}
                        </Text>
                    </Stack>
                </Card>
            </SimpleGrid>

            <Card withBorder padding="lg">
                <Stack gap="sm">
                    <Title order={5}>Recent runs</Title>
                    {summary.recent.length === 0 ? (
                        <Text c="dimmed">No runs yet.</Text>
                    ) : (
                        <Stack gap={4}>
                            {summary.recent.map((row) => (
                                <Group key={row.id} justify="space-between">
                                    <Text size="sm">
                                        Run #{row.id} —{' '}
                                        <Badge
                                            variant="light"
                                            color={row.status === 'completed' ? 'green' : 'yellow'}
                                        >
                                            {row.status}
                                        </Badge>
                                    </Text>
                                    <Text size="sm" c="dimmed">
                                        {new Date(row.startedAt).toLocaleString()}
                                    </Text>
                                </Group>
                            ))}
                        </Stack>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}

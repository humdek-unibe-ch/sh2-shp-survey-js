/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey responses table.
 *
 * Renders inside the unified `SurveyAdminPage` host shell as the
 * "Responses" tab. The initial fetch uses the admin responses
 * endpoint; subsequent updates flow over the
 * `surveys/{surveyId}/responses` realtime topic — no polling.
 *
 * The full per-response answer drill-down (FormUserInputRecord-style
 * detail panel) is deferred to a follow-up iteration; this scaffold
 * proves the runs metadata reaches the admin shell end-to-end.
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
    Paper,
    Stack,
    Table,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { IconRefresh, IconUserCheck } from '@tabler/icons-react';

import { fetchResponses } from '../api/surveys-admin';

interface IResponseRow {
    id: number;
    surveyId: number;
    revision: number;
    userId: number | null;
    startedAt: string;
    completedAt: string | null;
    status: string;
}

export interface ISurveyResponsesPageProps {
    surveyId?: number;
}

export function SurveyResponsesPage({ surveyId }: ISurveyResponsesPageProps = {}): React.ReactElement {
    const [items, setItems] = useState<IResponseRow[] | null>(null);
    const [total, setTotal] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);

    const reload = useCallback(async (): Promise<void> => {
        if (!surveyId) return;
        setBusy(true);
        setError(null);
        try {
            const data = await fetchResponses(surveyId, { page: 1, limit: 50 });
            setItems(data.items);
            setTotal(data.total);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const sortedItems = useMemo(
        () =>
            (items ?? [])
                .slice()
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
        [items],
    );

    if (!surveyId) {
        return (
            <Card withBorder p="lg">
                <Stack gap="xs" align="center">
                    <IconUserCheck size={32} />
                    <Title order={4}>No survey selected</Title>
                    <Text c="dimmed" size="sm">
                        Pick a survey from the list to see its responses.
                    </Text>
                </Stack>
            </Card>
        );
    }
    if (error) {
        return (
            <Alert color="red" title="Could not load responses">
                {error}
            </Alert>
        );
    }
    if (items === null) {
        return (
            <Group gap="xs" justify="center" py="md">
                <Loader size="sm" />
                <Text>Loading responses…</Text>
            </Group>
        );
    }

    return (
        <Stack gap="sm">
            <Group justify="space-between">
                <Group gap="xs">
                    <Title order={4}>Responses</Title>
                    <Badge variant="light">{total} total</Badge>
                </Group>
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
            {sortedItems.length === 0 ? (
                <Card withBorder p="lg">
                    <Stack gap="xs" align="center">
                        <Text c="dimmed">No responses recorded yet.</Text>
                        <Button variant="subtle" onClick={() => void reload()}>
                            Refresh
                        </Button>
                    </Stack>
                </Card>
            ) : (
                <Paper withBorder>
                    <Table verticalSpacing="sm" highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Run #</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Revision</Table.Th>
                                <Table.Th>User</Table.Th>
                                <Table.Th>Started</Table.Th>
                                <Table.Th>Completed</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {sortedItems.map((row) => (
                                <Table.Tr key={row.id}>
                                    <Table.Td>{row.id}</Table.Td>
                                    <Table.Td>
                                        <Badge
                                            variant="light"
                                            color={row.status === 'completed' ? 'green' : 'yellow'}
                                        >
                                            {row.status}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>v{row.revision}</Table.Td>
                                    <Table.Td>{row.userId ?? <Text c="dimmed">anon</Text>}</Table.Td>
                                    <Table.Td>
                                        <Text size="sm">{new Date(row.startedAt).toLocaleString()}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size="sm">
                                            {row.completedAt
                                                ? new Date(row.completedAt).toLocaleString()
                                                : '—'}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Paper>
            )}
        </Stack>
    );
}

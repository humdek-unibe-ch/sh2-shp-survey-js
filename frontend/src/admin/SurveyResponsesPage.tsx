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
 * Each row is a response in the survey's data table, unfinished or
 * submitted. The full list and its exports are the core data screen's.
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
    Modal,
    Paper,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import {
    IconDownload,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconUserCheck,
} from '@tabler/icons-react';
import { usePluginRealtime } from '@selfhelp/shared/plugin-sdk';

import {
    deleteResponse,
    fetchResponseDetail,
    fetchResponses,
    type ISurveyResponseSummary as IResponseRow,
} from '../api/surveys-admin';

function formatAnswer(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function savedTime(row: IResponseRow): number {
    return row.lastSavedAt ? new Date(row.lastSavedAt).getTime() : 0;
}

export interface ISurveyResponsesPageProps {
    surveyId?: number;
}

export function SurveyResponsesPage({ surveyId }: ISurveyResponsesPageProps = {}): React.ReactElement {
    const [items, setItems] = useState<IResponseRow[] | null>(null);
    const [total, setTotal] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [selected, setSelected] = useState<Awaited<ReturnType<typeof fetchResponseDetail>> | null>(null);
    const [filterQuery, setFilterQuery] = useState<string>('');
    const [pendingDelete, setPendingDelete] = useState<IResponseRow | null>(null);

    const realtime = usePluginRealtime<{ type: string }>({
        pluginId: 'sh2-shp-survey-js',
        topic: 'surveys/{surveyId}/responses',
        topicParams: surveyId ? { surveyId: String(surveyId) } : {},
        enabled: Boolean(surveyId),
    });

    const reload = useCallback(async (): Promise<void> => {
        if (!surveyId) return;
        setBusy(true);
        setError(null);
        try {
            const data = await fetchResponses(surveyId, { page: 1, limit: 200 });
            setItems(data.items);
            setTotal(data.total);
            setSelected(null);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [surveyId]);

    useEffect(() => {
        if (realtime.data?.type === 'response_submitted' || realtime.data?.type === 'response_deleted') {
            void reload();
        }
    }, [realtime.data, reload]);

    const confirmDelete = useCallback(async (): Promise<void> => {
        if (!surveyId || !pendingDelete) return;
        setBusy(true);
        try {
            await deleteResponse(surveyId, pendingDelete.responseId);
            setPendingDelete(null);
            await reload();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [pendingDelete, reload, surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const sortedItems = useMemo(
        () => {
            const all = (items ?? []).slice().sort((a, b) => savedTime(b) - savedTime(a));
            if (filterQuery.trim() === '') return all;
            const needle = filterQuery.trim().toLowerCase();
            return all.filter((row) => {
                const haystack = [
                    row.responseId,
                    row.finished ? 'submitted' : 'in progress',
                    row.userName ?? (row.userId === null ? 'guest' : String(row.userId)),
                    String(row.revision ?? ''),
                ]
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(needle);
            });
        },
        [filterQuery, items],
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
                    {realtime.error ? (
                        <Badge color="yellow" variant="light">Realtime offline</Badge>
                    ) : (
                        <Badge color="green" variant="light">Realtime live</Badge>
                    )}
                </Group>
                <Group gap="xs">
                    <TextInput
                        leftSection={<IconSearch size={14} />}
                        placeholder="Filter responses…"
                        value={filterQuery}
                        onChange={(e) => setFilterQuery(e.currentTarget.value)}
                        size="xs"
                    />
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
                                <Table.Th>Response ID</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th>Revision</Table.Th>
                                <Table.Th>User</Table.Th>
                                <Table.Th>Last saved</Table.Th>
                                <Table.Th style={{ width: 60 }} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {sortedItems.map((row) => (
                                <Table.Tr
                                    key={row.id}
                                    onClick={() => {
                                        void fetchResponseDetail(surveyId, row.responseId)
                                            .then(setSelected)
                                            .catch((err: Error) => setError(err.message));
                                    }}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <Table.Td>
                                        <Text size="sm" ff="monospace">{row.responseId}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge variant="light" color={row.finished ? 'green' : 'yellow'}>
                                            {row.finished ? 'submitted' : 'in progress'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>{row.revision !== null ? `v${row.revision}` : '—'}</Table.Td>
                                    <Table.Td>{row.userName ?? row.userId ?? <Text c="dimmed">guest</Text>}</Table.Td>
                                    <Table.Td>
                                        <Text size="sm">
                                            {row.lastSavedAt ? new Date(row.lastSavedAt).toLocaleString() : '—'}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap={4}>
                                            <Tooltip label="Open PDF">
                                                <ActionIcon
                                                    variant="subtle"
                                                    aria-label="Open response PDF"
                                                    component="a"
                                                    href={`/api/admin/plugins/sh2-shp-survey-js/surveys/${surveyId}/responses/${encodeURIComponent(row.responseId)}/pdf`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <IconDownload size={14} />
                                                </ActionIcon>
                                            </Tooltip>
                                            <Tooltip label="Delete response">
                                                <ActionIcon
                                                    color="red"
                                                    variant="subtle"
                                                    aria-label="Delete response"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPendingDelete(row);
                                                    }}
                                                >
                                                    <IconTrash size={14} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Paper>
            )}
            <Modal
                opened={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title="Delete response?"
                centered
            >
                <Stack gap="sm">
                    <Text size="sm">
                        Deleting response{' '}
                        <Text component="span" ff="monospace">
                            {pendingDelete?.responseId}
                        </Text>{' '}
                        removes it from the survey&apos;s data, the same as deleting it in the data screen (its history is kept).
                    </Text>
                    <Group justify="flex-end" gap="xs">
                        <Button variant="default" onClick={() => setPendingDelete(null)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button color="red" onClick={() => void confirmDelete()} loading={busy}>
                            Delete
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            {selected && (
                <Card withBorder padding="lg">
                    <Stack gap="sm">
                        <Group justify="space-between">
                            <Title order={5}>Response {selected.responseId}</Title>
                            <Badge variant="light">{Object.keys(selected.answers).length} answers</Badge>
                        </Group>
                        {Object.keys(selected.answers).length === 0 ? (
                            <Text c="dimmed" size="sm">
                                No answers were saved for this response.
                            </Text>
                        ) : (
                            <Table verticalSpacing="xs">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Question</Table.Th>
                                        <Table.Th>Value</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {Object.entries(selected.answers).map(([questionName, value]) => (
                                        <Table.Tr key={questionName}>
                                            <Table.Td>{questionName}</Table.Td>
                                            <Table.Td>
                                                <Text size="sm" lineClamp={3}>{formatAnswer(value)}</Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        )}
                    </Stack>
                </Card>
            )}
        </Stack>
    );
}

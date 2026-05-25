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
    Menu,
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
    buildResponsesExportUrl,
    deleteResponse,
    fetchResponseDetail,
    fetchResponses,
} from '../api/surveys-admin';

interface IResponseRow {
    id: number;
    responseId: string;
    surveyId: string;
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
            const all = (items ?? []).slice().sort(
                (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
            );
            if (filterQuery.trim() === '') return all;
            const needle = filterQuery.trim().toLowerCase();
            return all.filter((row) => {
                const haystack = [
                    row.responseId,
                    row.status,
                    row.userId === null ? 'anon' : String(row.userId),
                    String(row.revision),
                ]
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(needle);
            });
        },
        [filterQuery, items],
    );

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
                    {exportLinks !== null && (
                        <Menu shadow="md" withinPortal>
                            <Menu.Target>
                                <Button size="xs" variant="light" leftSection={<IconDownload size={14} />}>
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
                                <Table.Th>Started</Table.Th>
                                <Table.Th>Completed</Table.Th>
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
                                    <Table.Td>
                                        <Group gap={4}>
                                            <Tooltip label="Open PDF">
                                                <ActionIcon
                                                    variant="subtle"
                                                    aria-label="Open response PDF"
                                                    component="a"
                                                    href={`/cms-api/v1/admin/plugins/sh2-shp-survey-js/surveys/${surveyId}/responses/${encodeURIComponent(row.responseId)}/pdf`}
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
                        also removes any draft and uploaded files associated with it. This cannot be undone.
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
                            <Badge variant="light">{selected.answers.length} answers</Badge>
                        </Group>
                        {selected.answers.length === 0 ? (
                            <Text c="dimmed" size="sm">
                                No answer links were recorded for this run.
                            </Text>
                        ) : (
                            <Table verticalSpacing="xs">
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Question</Table.Th>
                                        <Table.Th>Type</Table.Th>
                                    <Table.Th>Value</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {selected.answers.map((answer) => (
                                        <Table.Tr key={answer.questionName}>
                                            <Table.Td>{answer.questionName}</Table.Td>
                                            <Table.Td>{answer.questionType}</Table.Td>
                                            <Table.Td>
                                                <Text size="sm" lineClamp={3}>{answer.value || '—'}</Text>
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

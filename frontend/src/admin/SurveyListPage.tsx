/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The survey list: the surveys the caller may see, with the actions their
 * rights allow (the server sends them per survey and checks again on every
 * call). Built like the host's list screens: page header, filter card,
 * admin table, row actions in the usual order.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Button,
    Card,
    Code,
    Group,
    Loader,
    Popover,
    SegmentedControl,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
    VisuallyHidden,
} from '@mantine/core';
import { IconArchive, IconArchiveOff, IconCode, IconCopy, IconEye, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';

import {
    createSurvey,
    deleteSurvey,
    duplicateSurvey,
    fetchLicenseKey,
    getSurvey,
    listSurveys,
    updateSurvey,
    type IAdminSurveyList,
    type IAdminSurveySummary,
} from '../api/surveys-admin';
import { IS_DEV_RUNTIME } from '../runtime-mode';
import type { TSurveyView } from './adminUrl';
import { dataScreenUrl } from './dataScreenUrl';
import { filterSurveys, type TStateFilter } from './surveyListFilter';
import { AdminModal, EmptyState, PageHeader } from './ui/AdminUi';

interface ISurveyListPageProps {
    onOpen: (surveyId: number, view: TSurveyView) => void;
}

export function SurveyListPage({ onOpen }: ISurveyListPageProps): React.ReactElement {
    const [list, setList] = useState<IAdminSurveyList | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [search, setSearch] = useState<string>('');
    const [state, setState] = useState<TStateFilter>('active');
    const [creating, setCreating] = useState<boolean>(false);
    const [pendingDelete, setPendingDelete] = useState<IAdminSurveySummary | null>(null);
    // The last archive or unarchive, so the row leaving the current filter is explained and can be undone.
    const [archivedNotice, setArchivedNotice] = useState<{ survey: IAdminSurveySummary; archived: boolean } | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        try {
            setList(await listSurveys());
            setError(null);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const run = useCallback(async (survey: IAdminSurveySummary, action: () => Promise<unknown>): Promise<boolean> => {
        setBusyId(survey.id);
        setError(null);
        // A later action makes the last archive note stale; archiving sets a new one afterwards.
        setArchivedNotice((notice) => (notice !== null && notice.survey.id === survey.id ? notice : null));
        try {
            await action();
            await reload();
            return true;
        } catch (err) {
            setError((err as Error).message);
            return false;
        } finally {
            setBusyId(null);
        }
    }, [reload]);

    const setArchived = useCallback(async (survey: IAdminSurveySummary, archived: boolean): Promise<void> => {
        const ok = await run(survey, () => updateSurvey(survey.id, { archived }));
        setArchivedNotice(ok ? { survey, archived } : null);
    }, [run]);

    const visible = useMemo(() => filterSurveys(list?.items ?? [], search, state), [list, search, state]);
    const archivedCount = useMemo(() => (list?.items ?? []).filter((survey) => survey.archived).length, [list]);

    return (
        <Stack gap="md">
            <PageHeader
                title="Surveys"
                subtitle="Build surveys, publish them, and see their answers. A survey reaches participants through a SurveyJS section on a page."
                badge={list?.items.length}
                badgeAriaLabel="surveys"
            >
                <LicenseBadge />
                {IS_DEV_RUNTIME && <DevReloadHint />}
                {list?.canCreate && (
                    <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
                        New survey
                    </Button>
                )}
            </PageHeader>

            <Card withBorder p="md">
                <Group gap="md" align="flex-end" wrap="wrap">
                    <TextInput
                        label="Search"
                        placeholder="Name or survey ID"
                        leftSection={<IconSearch size={14} />}
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        style={{ flex: 1, minWidth: 220 }}
                    />
                    <Stack gap={4}>
                        <Text size="sm" fw={500} id="survey-state-filter">State</Text>
                        <SegmentedControl
                            aria-labelledby="survey-state-filter"
                            value={state}
                            onChange={(value) => setState(value as TStateFilter)}
                            data={[
                                { value: 'active', label: 'Active' },
                                { value: 'archived', label: `Archived (${archivedCount})` },
                                { value: 'all', label: 'All' },
                            ]}
                        />
                    </Stack>
                    {(search !== '' || state !== 'active') && (
                        <Button variant="subtle" onClick={() => { setSearch(''); setState('active'); }}>
                            Reset
                        </Button>
                    )}
                </Group>
            </Card>

            {error && (
                <Alert color="red" title="Something went wrong" withCloseButton onClose={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {archivedNotice && (
                <Alert color="teal" withCloseButton onClose={() => setArchivedNotice(null)} role="status">
                    <Group justify="space-between" gap="sm" wrap="wrap">
                        <Text size="sm">
                            <strong>{archivedNotice.survey.name}</strong>{' '}
                            {archivedNotice.archived
                                ? 'is archived: participants can no longer answer it. It is listed under Archived.'
                                : 'is active again: participants can answer it.'}
                        </Text>
                        <Group gap="xs">
                            {archivedNotice.archived && state === 'active' && (
                                <Button size="xs" variant="subtle" onClick={() => setState('archived')}>
                                    Show archived
                                </Button>
                            )}
                            {!archivedNotice.archived && state === 'archived' && (
                                <Button size="xs" variant="subtle" onClick={() => setState('active')}>
                                    Show active
                                </Button>
                            )}
                            <Button
                                size="xs"
                                variant="light"
                                onClick={() => {
                                    const { survey, archived } = archivedNotice;
                                    void run(survey, () => updateSurvey(survey.id, { archived: !archived })).then((ok) => {
                                        if (!ok) return;
                                        setArchivedNotice(null);
                                        // Show the survey where it is now, so undoing never hides it.
                                        if (state !== 'all') setState(archived ? 'active' : 'archived');
                                    });
                                }}
                                loading={busyId === archivedNotice.survey.id}
                            >
                                Undo
                            </Button>
                        </Group>
                    </Group>
                </Alert>
            )}

            {list === null ? (
                !error && (
                    <Group gap="xs" justify="center" py="xl">
                        <Loader size="sm" />
                        <Text>Loading surveys…</Text>
                    </Group>
                )
            ) : (
                <div className="sjs-admin-table">
                    <div className="sjs-admin-table__scroll">
                        <Table verticalSpacing="sm" highlightOnHover>
                            <Table.Thead className="sjs-admin-table__head">
                                <Table.Tr>
                                    <Table.Th>Name</Table.Th>
                                    <Table.Th>Version</Table.Th>
                                    <Table.Th>Answers</Table.Th>
                                    <Table.Th>Updated</Table.Th>
                                    <Table.Th>State</Table.Th>
                                    <Table.Th>
                                        <VisuallyHidden>Actions</VisuallyHidden>
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {visible.length === 0 ? (
                                    <Table.Tr>
                                        <Table.Td colSpan={6}>
                                            {list.items.length === 0 ? (
                                                <EmptyState
                                                    title="No surveys yet"
                                                    description={list.canCreate
                                                        ? 'Create one with New survey.'
                                                        : 'No survey is shared with your roles.'}
                                                />
                                            ) : (
                                                <EmptyState title="No surveys match" description="Change the search or the state filter." />
                                            )}
                                        </Table.Td>
                                    </Table.Tr>
                                ) : (
                                    visible.map((survey) => (
                                        <SurveyRow
                                            key={survey.id}
                                            survey={survey}
                                            busy={busyId === survey.id}
                                            canCreate={list.canCreate}
                                            onOpen={onOpen}
                                            onDuplicate={() => void run(survey, async () => duplicateSurvey(await getSurvey(survey.id)))}
                                            onArchive={() => void setArchived(survey, !survey.archived)}
                                            onDelete={() => setPendingDelete(survey)}
                                        />
                                    ))
                                )}
                            </Table.Tbody>
                        </Table>
                    </div>
                    <Group className="sjs-admin-table__footer">
                        <Text size="sm" c="dimmed">
                            Showing <Text span fw={700} c="var(--mantine-color-text)" inherit>{visible.length}</Text> of{' '}
                            <Text span fw={700} c="var(--mantine-color-text)" inherit>{list.items.length}</Text> surveys
                        </Text>
                    </Group>
                </div>
            )}

            <NewSurveyModal
                opened={creating}
                onClose={() => setCreating(false)}
                onCreated={(id) => {
                    setCreating(false);
                    onOpen(id, 'design');
                }}
            />

            <AdminModal
                opened={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title="Delete survey"
                size="md"
                onDelete={() => {
                    const target = pendingDelete;
                    if (target === null) return;
                    void run(target, () => deleteSurvey(target.id)).then((ok) => {
                        if (ok) setPendingDelete(null);
                    });
                }}
                deleteLabel="Delete survey"
                isLoading={pendingDelete !== null && busyId === pendingDelete.id}
            >
                <Alert color="red" title="This cannot be undone">
                    <Text size="sm">
                        <strong>{pendingDelete?.name}</strong> is deleted with all its versions
                        {pendingDelete?.responseCount ? `, its ${pendingDelete.responseCount} answers and their uploaded files` : ' and any answers it has'}.
                        Sections that place it show nothing afterwards. To stop new answers but keep everything,
                        archive it instead.
                    </Text>
                </Alert>
                {error && (
                    <Text size="sm" c="red" mt="sm" role="alert">
                        Could not delete: {error}
                    </Text>
                )}
            </AdminModal>
        </Stack>
    );
}

interface ISurveyRowProps {
    survey: IAdminSurveySummary;
    busy: boolean;
    canCreate: boolean;
    onOpen: (surveyId: number, view: TSurveyView) => void;
    onDuplicate: () => void;
    onArchive: () => void;
    onDelete: () => void;
}

function SurveyRow({ survey, busy, canCreate, onOpen, onDuplicate, onArchive, onDelete }: ISurveyRowProps): React.ReactElement {
    const openView: TSurveyView = survey.rights.update ? 'design' : 'answers';

    return (
        <Table.Tr>
            <Table.Td>
                <Anchor component="button" type="button" fw={500} onClick={() => onOpen(survey.id, openView)}>
                    {survey.name}
                </Anchor>
                <Text className="sjs-admin-table__mono">{survey.surveyId}</Text>
            </Table.Td>
            <Table.Td>
                {survey.currentRevision === null ? (
                    <Badge color="yellow" variant="light">Not published</Badge>
                ) : (
                    <Badge variant="light">v{survey.currentRevision}</Badge>
                )}
            </Table.Td>
            <Table.Td>
                {survey.responseCount === null ? (
                    <Tooltip label="You have no access to this survey's answers">
                        <Text size="sm" c="dimmed">—</Text>
                    </Tooltip>
                ) : survey.dataTableId !== null ? (
                    <Tooltip label="Open the answers in the Data screen">
                        <Anchor href={dataScreenUrl(survey.dataTableId)} size="sm">
                            {survey.responseCount}
                        </Anchor>
                    </Tooltip>
                ) : (
                    <Text size="sm">{survey.responseCount}</Text>
                )}
            </Table.Td>
            <Table.Td>
                <Text size="sm">{new Date(survey.updatedAt).toLocaleString()}</Text>
            </Table.Td>
            <Table.Td>
                {survey.archived ? (
                    <Badge color="gray" variant="light">Archived</Badge>
                ) : (
                    <Badge color="green" variant="light">Active</Badge>
                )}
            </Table.Td>
            <Table.Td className="sjs-admin-table__actions">
                <Group gap={4} wrap="nowrap" justify="flex-end">
                    <Tooltip label="Answers">
                        <ActionIcon variant="subtle" color="blue" onClick={() => onOpen(survey.id, 'answers')} aria-label={`Answers of ${survey.name}`}>
                            <IconEye size={16} />
                        </ActionIcon>
                    </Tooltip>
                    {survey.rights.update && (
                        <Tooltip label="Edit">
                            <ActionIcon variant="subtle" color="gray" onClick={() => onOpen(survey.id, 'design')} aria-label={`Edit ${survey.name}`}>
                                <IconPencil size={16} />
                            </ActionIcon>
                        </Tooltip>
                    )}
                    {canCreate && (
                        <Tooltip label="Duplicate as a new draft">
                            <ActionIcon variant="subtle" color="gray" onClick={onDuplicate} loading={busy} aria-label={`Duplicate ${survey.name}`}>
                                <IconCopy size={16} />
                            </ActionIcon>
                        </Tooltip>
                    )}
                    {survey.rights.update && (
                        <Tooltip label={survey.archived ? 'Unarchive' : 'Archive: participants can no longer answer it; versions and answers are kept'}>
                            <ActionIcon
                                variant="subtle"
                                color="gray"
                                onClick={onArchive}
                                disabled={busy}
                                aria-label={`${survey.archived ? 'Unarchive' : 'Archive'} ${survey.name}`}
                            >
                                {survey.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />}
                            </ActionIcon>
                        </Tooltip>
                    )}
                    {survey.rights.delete && (
                        <Tooltip label="Delete">
                            <ActionIcon variant="subtle" color="red" onClick={onDelete} disabled={busy} aria-label={`Delete ${survey.name}`}>
                                <IconTrash size={16} />
                            </ActionIcon>
                        </Tooltip>
                    )}
                </Group>
            </Table.Td>
        </Table.Tr>
    );
}

function LicenseBadge(): React.ReactElement | null {
    const [configured, setConfigured] = useState<boolean | null>(null);

    useEffect(() => {
        fetchLicenseKey()
            .then((data) => setConfigured(data.configured))
            .catch(() => setConfigured(null));
    }, []);

    if (configured === null) return null;
    return configured ? (
        <Badge color="green" variant="light">Licence set</Badge>
    ) : (
        <Tooltip label="Set SURVEYJS_LICENSE_KEY in the backend environment to remove the SurveyJS watermark from the editor, charts and PDF." multiline w={280}>
            <Badge color="yellow" variant="light" tabIndex={0}>No licence</Badge>
        </Tooltip>
    );
}

/** Only in the plugin's development runtime: how live reload is wired. */
function DevReloadHint(): React.ReactElement {
    return (
        <Popover width={360} position="bottom-end" withArrow shadow="md">
            <Popover.Target>
                <Tooltip label="Developer live reload">
                    <ActionIcon variant="subtle" color="gray" aria-label="Developer live reload">
                        <IconCode size={16} />
                    </ActionIcon>
                </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
                <Stack gap={4}>
                    <Text size="sm" fw={600}>Developer live reload</Text>
                    <Text size="xs" c="dimmed">
                        Attach the backend once, then keep the runtime server open while editing the plugin UI.
                    </Text>
                    <Code block>
                        node scripts/install-local.mjs --symlink{'\n'}
                        npm --prefix frontend run dev:runtime
                    </Code>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}

interface INewSurveyModalProps {
    opened: boolean;
    onClose: () => void;
    onCreated: (surveyId: number) => void;
}

function NewSurveyModal({ opened, onClose, onCreated }: INewSurveyModalProps): React.ReactElement {
    const [name, setName] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    // Set once a submit is tried, so "Enter a name" shows only after that, not on opening.
    const [tried, setTried] = useState<boolean>(false);

    useEffect(() => {
        if (!opened) {
            setName('');
            setError(null);
            setSubmitting(false);
            setTried(false);
        }
    }, [opened]);

    const submit = async (): Promise<void> => {
        setTried(true);
        if (name.trim() === '') return;
        setSubmitting(true);
        setError(null);
        try {
            const created = await createSurvey({ name: name.trim(), definition: { pages: [] } });
            onCreated(created.id);
        } catch (err) {
            setError((err as Error).message);
            setSubmitting(false);
        }
    };

    return (
        <AdminModal
            opened={opened}
            onClose={onClose}
            title="New survey"
            size="md"
            onSave={() => void submit()}
            saveLabel="Create and edit"
            isLoading={submitting}
            disabled={name.trim() === ''}
        >
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <Stack gap="sm">
                    <TextInput
                        label="Name"
                        description="For editors only; you can change it later. Participants see the title you give the survey in the editor."
                        placeholder="Sleep diary"
                        required
                        data-autofocus
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                        disabled={submitting}
                        error={tried && name.trim() === '' ? 'Enter a name.' : undefined}
                    />
                    {error && (
                        <Alert color="red" title="Could not create the survey">
                            {error}
                        </Alert>
                    )}
                </Stack>
            </form>
        </AdminModal>
    );
}

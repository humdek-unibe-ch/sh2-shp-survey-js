/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Surveys admin host page.
 *
 * The host's plugin route accepts only single-segment slugs
 * (`/admin/plugins-host/<plugin-id>/<slug>`), so this page is the
 * one entry point for every survey-management view in the plugin.
 * It owns its own sub-routing through `?view=` and `?id=` query
 * params (`list`, `designer`, `responses`, `dashboard`, `settings`),
 * keeping the URL deep-linkable while staying compatible with the
 * single-slug constraint.
 *
 * Wired actions (all gated server-side by the same role permissions
 * the host's `ApiSecurityListener` enforces):
 *
 *   - `New Survey`  → POST `/admin/plugins/sh2-shp-survey-js/surveys`
 *   - `Edit/Designer` → opens the SurveyJS Creator (`SurveyDesignerPage`)
 *   - `Publish`     → POST `…/{id}/versions` (driven from the Creator)
 *   - `Duplicate`   → composes `getSurvey + create + publishVersion`
 *   - `Archive` / `Unarchive` → PUT `…/{id}` with `archived`
 *   - `Delete`      → DELETE `…/{id}` (modal confirm)
 *   - `Responses` / `Dashboard` open the corresponding inner views.
 *
 * The list refreshes after every mutating action via
 * {@link SurveyAdminPage#reload}; the host's no-polling rule still
 * holds — realtime updates from the
 * `surveys/{surveyId}/editing|responses` topics are wired in their
 * respective sub-views, not here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Anchor,
    Badge,
    Box,
    Button,
    Card,
    Code,
    Group,
    Loader,
    Menu,
    Modal,
    Paper,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import {
    IconArchive,
    IconChartBar,
    IconCheck,
    IconChevronLeft,
    IconClipboardList,
    IconCopy,
    IconDots,
    IconEdit,
    IconHistory,
    IconList,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconSettings,
    IconTrash,
    IconUserCheck,
    IconX,
} from '@tabler/icons-react';

import {
    createSurvey,
    deleteSurvey,
    duplicateSurvey,
    fetchLicenseKey,
    getSurvey,
    listSurveys,
    updateSurvey,
    type IAdminSurveyDetail,
    type IAdminSurveySummary,
} from '../api/surveys-admin';
import { SurveyDesignerPage } from './SurveyDesignerPage';
import { SurveyResponsesPage } from './SurveyResponsesPage';
import { SurveyDashboardPage } from './SurveyDashboardPage';
import { SurveySettingsPage } from './SurveySettingsPage';
import { SurveyVersionsPage } from './SurveyVersionsPage';

type TView = 'list' | 'designer' | 'responses' | 'dashboard' | 'versions' | 'settings';

interface IUrlState {
    view: TView;
    surveyId: number | null;
}

const VIEWS_REQUIRING_SURVEY: ReadonlySet<TView> = new Set<TView>([
    'designer',
    'responses',
    'dashboard',
    'versions',
    'settings',
]);

function readUrlState(): IUrlState {
    if (typeof window === 'undefined') {
        return { view: 'list', surveyId: null };
    }
    const search = new URLSearchParams(window.location.search);
    const rawView = (search.get('view') ?? 'list') as TView;
    const view: TView = (['list', 'designer', 'responses', 'dashboard', 'versions', 'settings'] as const).includes(
        rawView,
    )
        ? rawView
        : 'list';
    const idRaw = search.get('id');
    const surveyId = idRaw && /^\d+$/.test(idRaw) ? Number(idRaw) : null;
    return { view, surveyId };
}

function writeUrlState(next: IUrlState): void {
    if (typeof window === 'undefined') return;
    const search = new URLSearchParams(window.location.search);
    if (next.view === 'list') {
        search.delete('view');
    } else {
        search.set('view', next.view);
    }
    if (next.surveyId === null) {
        search.delete('id');
    } else {
        search.set('id', String(next.surveyId));
    }
    const qs = search.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    window.history.replaceState(null, '', url);
}

export function SurveyAdminPage(): React.ReactElement {
    const [{ view, surveyId }, setUrlState] = useState<IUrlState>(() => readUrlState());

    const setView = useCallback((nextView: TView, nextId?: number | null) => {
        setUrlState((prev) => {
            return {
                view: nextView,
                surveyId: nextId === undefined ? prev.surveyId : nextId,
            };
        });
    }, []);

    // Restore state when the user uses browser back/forward.
    useEffect(() => {
        const onPopState = (): void => setUrlState(readUrlState());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const safeView = useMemo<TView>(() => {
        if (VIEWS_REQUIRING_SURVEY.has(view) && surveyId === null) {
            return 'list';
        }
        return view;
    }, [view, surveyId]);

    useEffect(() => {
        writeUrlState({ view: safeView, surveyId: safeView === view ? surveyId : null });
    }, [safeView, surveyId, view]);

    return (
        <Stack gap="md" p="md">
            <Group justify="space-between" align="flex-end">
                <Stack gap={2}>
                    <Title order={2}>SurveyJS</Title>
                    <Text c="dimmed" size="sm">
                        Manage SurveyJS surveys: design, publish, view responses, and configure the plugin.
                    </Text>
                </Stack>
                {safeView !== 'list' && (
                    <Button
                        variant="light"
                        leftSection={<IconChevronLeft size={16} />}
                        onClick={() => setView('list', null)}
                    >
                        Back to list
                    </Button>
                )}
            </Group>
            <Tabs
                value={safeView}
                onChange={(next) => setView((next ?? 'list') as TView)}
                keepMounted={false}
            >
                <Tabs.List>
                    <Tabs.Tab value="list" leftSection={<IconList size={14} />}>
                        Surveys list
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="designer"
                        leftSection={<IconPencil size={14} />}
                        disabled={surveyId === null}
                    >
                        Designer
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="responses"
                        leftSection={<IconUserCheck size={14} />}
                        disabled={surveyId === null}
                    >
                        Responses
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="dashboard"
                        leftSection={<IconChartBar size={14} />}
                        disabled={surveyId === null}
                    >
                        Dashboard
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="versions"
                        leftSection={<IconHistory size={14} />}
                        disabled={surveyId === null}
                    >
                        Versions
                    </Tabs.Tab>
                    <Tabs.Tab value="settings" leftSection={<IconSettings size={14} />} disabled={surveyId === null}>
                        Settings
                    </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="list" pt="md">
                    <SurveyListPanel onOpen={(id, target) => setView(target, id)} />
                </Tabs.Panel>
                <Tabs.Panel value="designer" pt="md">
                    {surveyId !== null && (
                        <SurveyDesignerPage surveyId={surveyId} />
                    )}
                </Tabs.Panel>
                <Tabs.Panel value="responses" pt="md">
                    {surveyId !== null && <SurveyResponsesPage surveyId={surveyId} />}
                </Tabs.Panel>
                <Tabs.Panel value="dashboard" pt="md">
                    {surveyId !== null && <SurveyDashboardPage surveyId={surveyId} />}
                </Tabs.Panel>
                <Tabs.Panel value="versions" pt="md">
                    {surveyId !== null && <SurveyVersionsPage surveyId={surveyId} />}
                </Tabs.Panel>
                <Tabs.Panel value="settings" pt="md">
                    {surveyId !== null && (
                        <SurveySettingsPage surveyId={surveyId} />
                    )}
                </Tabs.Panel>
            </Tabs>
        </Stack>
    );
}

interface ISurveyListPanelProps {
    onOpen: (surveyId: number, target: TView) => void;
}

function SurveyListPanel({ onOpen }: ISurveyListPanelProps): React.ReactElement {
    const [items, setItems] = useState<IAdminSurveySummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [showCreate, setShowCreate] = useState<boolean>(false);
    const [pendingDelete, setPendingDelete] = useState<IAdminSurveySummary | null>(null);
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameValue, setRenameValue] = useState<string>('');
    const renameInputRef = useRef<HTMLInputElement>(null);

    const reload = useCallback(async (): Promise<void> => {
        setError(null);
        try {
            const data = await listSurveys();
            setItems(data);
        } catch (err) {
            setError((err as Error).message);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    useEffect(() => {
        if (renamingId !== null && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingId]);

    const startRename = useCallback((survey: IAdminSurveySummary): void => {
        setRenamingId(survey.id);
        setRenameValue(survey.name);
        setError(null);
    }, []);

    const cancelRename = useCallback((): void => {
        setRenamingId(null);
        setRenameValue('');
    }, []);

    const commitRename = useCallback(async (): Promise<void> => {
        if (renamingId === null) return;
        const trimmed = renameValue.trim();
        if (trimmed === '') {
            cancelRename();
            return;
        }
        const target = items?.find((s) => s.id === renamingId);
        if (target && target.name === trimmed) {
            cancelRename();
            return;
        }
        setBusy(true);
        try {
            await updateSurvey(renamingId, { name: trimmed });
            await reload();
            setRenamingId(null);
            setRenameValue('');
        } catch (err) {
            setError(`Rename failed: ${(err as Error).message}`);
        } finally {
            setBusy(false);
        }
    }, [cancelRename, items, reload, renameValue, renamingId]);

    const handleArchive = useCallback(
        async (survey: IAdminSurveySummary, archived: boolean): Promise<void> => {
            setBusy(true);
            try {
                await updateSurvey(survey.id, { archived });
                await reload();
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setBusy(false);
            }
        },
        [reload],
    );

    const handleDuplicate = useCallback(
        async (survey: IAdminSurveySummary): Promise<void> => {
            setBusy(true);
            try {
                const detail: IAdminSurveyDetail = await getSurvey(survey.id);
                await duplicateSurvey(detail);
                await reload();
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setBusy(false);
            }
        },
        [reload],
    );

    const confirmDelete = useCallback(async (): Promise<void> => {
        if (pendingDelete === null) return;
        setBusy(true);
        try {
            await deleteSurvey(pendingDelete.id);
            setPendingDelete(null);
            await reload();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [pendingDelete, reload]);

    return (
        <Stack gap="sm">
            <Group justify="space-between">
                <Group gap="xs">
                    <Button leftSection={<IconPlus size={16} />} onClick={() => setShowCreate(true)}>
                        New Survey
                    </Button>
                    <Tooltip label="Reload">
                        <ActionIcon variant="subtle" onClick={() => void reload()} aria-label="Reload">
                            <IconRefresh size={16} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
                {items !== null && (
                    <Text size="sm" c="dimmed">
                        {items.length} surveys
                    </Text>
                )}
            </Group>

            {error && (
                <Alert color="red" title="Failed to load surveys">
                    {error}
                </Alert>
            )}

            {items === null ? (
                <Group gap="xs" justify="center" py="md">
                    <Loader size="sm" />
                    <Text>Loading surveys…</Text>
                </Group>
            ) : items.length === 0 ? (
                <Card withBorder p="lg">
                    <Stack gap="xs" align="center">
                        <IconClipboardList size={32} />
                        <Title order={4}>No surveys yet</Title>
                        <Text c="dimmed" ta="center" size="sm">
                            Click <strong>New Survey</strong> to create your first one. The Designer opens once
                            the survey row exists.
                        </Text>
                    </Stack>
                </Card>
            ) : (
                <Paper withBorder>
                    <Table verticalSpacing="sm" highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>Revision</Table.Th>
                                <Table.Th>Responses</Table.Th>
                                <Table.Th>Updated</Table.Th>
                                <Table.Th>State</Table.Th>
                                <Table.Th style={{ width: 60 }} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {items.map((survey) => (
                                <SurveyListRow
                                    key={survey.id}
                                    survey={survey}
                                    busy={busy}
                                    renaming={renamingId === survey.id}
                                    renameValue={renameValue}
                                    renameInputRef={renameInputRef}
                                    onOpen={onOpen}
                                    onStartRename={startRename}
                                    onCancelRename={cancelRename}
                                    onCommitRename={() => void commitRename()}
                                    onRenameChange={setRenameValue}
                                    onDuplicate={() => void handleDuplicate(survey)}
                                    onArchive={() => void handleArchive(survey, !survey.archived)}
                                    onDelete={() => setPendingDelete(survey)}
                                />
                            ))}
                        </Table.Tbody>
                    </Table>
                </Paper>
            )}

            <NewSurveyModal
                opened={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={async (createdId) => {
                    setShowCreate(false);
                    await reload();
                    onOpen(createdId, 'designer');
                }}
            />

            <PluginOperationsPanel />

            <Modal
                opened={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title="Delete survey?"
                centered
            >
                <Stack gap="sm">
                    <Text>
                        This will permanently delete <strong>{pendingDelete?.name}</strong> and all its
                        responses. This action cannot be undone.
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
        </Stack>
    );
}

interface ISurveyListRowProps {
    survey: IAdminSurveySummary;
    busy: boolean;
    renaming: boolean;
    renameValue: string;
    renameInputRef: React.RefObject<HTMLInputElement | null>;
    onOpen: (id: number, target: TView) => void;
    onStartRename: (survey: IAdminSurveySummary) => void;
    onCancelRename: () => void;
    onCommitRename: () => void;
    onRenameChange: (value: string) => void;
    onDuplicate: () => void;
    onArchive: () => void;
    onDelete: () => void;
}

function SurveyListRow({
    survey,
    busy,
    renaming,
    renameValue,
    renameInputRef,
    onOpen,
    onStartRename,
    onCancelRename,
    onCommitRename,
    onRenameChange,
    onDuplicate,
    onArchive,
    onDelete,
}: ISurveyListRowProps): React.ReactElement {
    const [menuOpened, setMenuOpened] = useState<boolean>(false);
    const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

    const handleContextMenu = useCallback((event: React.MouseEvent): void => {
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
        setMenuOpened(true);
    }, []);

    return (
        <Table.Tr onContextMenu={handleContextMenu} style={{ cursor: renaming ? 'text' : 'default' }}>
            <Table.Td>
                {renaming ? (
                    <Group gap="xs" wrap="nowrap">
                        <TextInput
                            ref={renameInputRef}
                            size="xs"
                            value={renameValue}
                            onChange={(e) => onRenameChange(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onCommitRename();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    onCancelRename();
                                }
                            }}
                            disabled={busy}
                            style={{ flex: 1 }}
                            aria-label="Rename survey"
                        />
                        <Tooltip label="Save (Enter)">
                            <ActionIcon
                                size="sm"
                                color="green"
                                variant="filled"
                                onClick={onCommitRename}
                                loading={busy}
                                aria-label="Save rename"
                            >
                                <IconCheck size={14} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Cancel (Esc)">
                            <ActionIcon
                                size="sm"
                                variant="subtle"
                                onClick={onCancelRename}
                                disabled={busy}
                                aria-label="Cancel rename"
                            >
                                <IconX size={14} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                ) : (
                    <Group gap="xs" wrap="nowrap">
                        <Anchor onClick={() => onOpen(survey.id, 'designer')} title="Open in Designer">
                            {survey.name}
                        </Anchor>
                        <Tooltip label="Rename (or right-click)">
                            <ActionIcon
                                size="xs"
                                variant="subtle"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onStartRename(survey);
                                }}
                                aria-label="Rename survey"
                            >
                                <IconEdit size={12} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                )}
                <Text size="xs" c="dimmed">
                    Survey ID: <Code>{survey.surveyId}</Code>
                </Text>
            </Table.Td>
            <Table.Td>
                {survey.currentRevision === null ? (
                    <Text c="dimmed">draft</Text>
                ) : (
                    <Badge variant="light">v{survey.currentRevision}</Badge>
                )}
            </Table.Td>
            <Table.Td>{survey.responseCount}</Table.Td>
            <Table.Td>
                <Text size="sm">{new Date(survey.updatedAt).toLocaleString()}</Text>
            </Table.Td>
            <Table.Td>
                {survey.archived ? (
                    <Badge color="gray" variant="light">archived</Badge>
                ) : (
                    <Badge color="green" variant="light">active</Badge>
                )}
            </Table.Td>
            <Table.Td>
                <Menu shadow="md" position="bottom-end" withinPortal>
                    <Menu.Target>
                        <ActionIcon
                            variant="subtle"
                            aria-label="Survey actions"
                            disabled={busy || renaming}
                        >
                            <IconDots size={16} />
                        </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                        <Menu.Item
                            leftSection={<IconPencil size={14} />}
                            onClick={() => onOpen(survey.id, 'designer')}
                        >
                            Open Designer
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconEdit size={14} />}
                            onClick={() => onStartRename(survey)}
                        >
                            Rename…
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconUserCheck size={14} />}
                            onClick={() => onOpen(survey.id, 'responses')}
                        >
                            Responses
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconChartBar size={14} />}
                            onClick={() => onOpen(survey.id, 'dashboard')}
                        >
                            Dashboard
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconHistory size={14} />}
                            onClick={() => onOpen(survey.id, 'versions')}
                        >
                            Versions
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconSettings size={14} />}
                            onClick={() => onOpen(survey.id, 'settings')}
                        >
                            Settings
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                            leftSection={<IconCopy size={14} />}
                            onClick={onDuplicate}
                        >
                            Duplicate
                        </Menu.Item>
                        <Menu.Item
                            leftSection={<IconArchive size={14} />}
                            onClick={onArchive}
                        >
                            {survey.archived ? 'Unarchive' : 'Archive'}
                        </Menu.Item>
                        <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={onDelete}
                        >
                            Delete…
                        </Menu.Item>
                    </Menu.Dropdown>
                </Menu>
            </Table.Td>
            {menuOpened && menuPosition && (
                <ContextMenuPortal
                    position={menuPosition}
                    onClose={() => setMenuOpened(false)}
                >
                    <Menu.Item
                        leftSection={<IconPencil size={14} />}
                        onClick={() => {
                            onOpen(survey.id, 'designer');
                            setMenuOpened(false);
                        }}
                    >
                        Open Designer
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() => {
                            onStartRename(survey);
                            setMenuOpened(false);
                        }}
                    >
                        Rename
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconUserCheck size={14} />}
                        onClick={() => {
                            onOpen(survey.id, 'responses');
                            setMenuOpened(false);
                        }}
                    >
                        Responses
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconChartBar size={14} />}
                        onClick={() => {
                            onOpen(survey.id, 'dashboard');
                            setMenuOpened(false);
                        }}
                    >
                        Dashboard
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconHistory size={14} />}
                        onClick={() => {
                            onOpen(survey.id, 'versions');
                            setMenuOpened(false);
                        }}
                    >
                        Versions
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconSettings size={14} />}
                        onClick={() => {
                            onOpen(survey.id, 'settings');
                            setMenuOpened(false);
                        }}
                    >
                        Settings
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                        leftSection={<IconCopy size={14} />}
                        onClick={() => {
                            onDuplicate();
                            setMenuOpened(false);
                        }}
                    >
                        Duplicate
                    </Menu.Item>
                    <Menu.Item
                        leftSection={<IconArchive size={14} />}
                        onClick={() => {
                            onArchive();
                            setMenuOpened(false);
                        }}
                    >
                        {survey.archived ? 'Unarchive' : 'Archive'}
                    </Menu.Item>
                    <Menu.Item
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => {
                            onDelete();
                            setMenuOpened(false);
                        }}
                    >
                        Delete…
                    </Menu.Item>
                </ContextMenuPortal>
            )}
        </Table.Tr>
    );
}

interface IContextMenuPortalProps {
    position: { x: number; y: number };
    onClose: () => void;
    children: React.ReactNode;
}

function ContextMenuPortal({ position, onClose, children }: IContextMenuPortalProps): React.ReactElement {
    useEffect(() => {
        const handleClick = (event: MouseEvent): void => {
            const target = event.target as HTMLElement | null;
            if (target && target.closest('[data-survey-context-menu]')) {
                return;
            }
            onClose();
        };
        const handleEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('mousedown', handleClick);
        window.addEventListener('keydown', handleEscape);
        return () => {
            window.removeEventListener('mousedown', handleClick);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    return (
        <Box
            data-survey-context-menu
            style={{
                position: 'fixed',
                left: position.x,
                top: position.y,
                zIndex: 1000,
                minWidth: 180,
                background: 'var(--mantine-color-body)',
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-sm)',
                boxShadow: 'var(--mantine-shadow-md)',
                padding: 4,
            }}
            role="menu"
        >
            {children}
        </Box>
    );
}

function PluginOperationsPanel(): React.ReactElement {
    const [license, setLicense] = useState<{ configured: boolean } | null>(null);

    useEffect(() => {
        fetchLicenseKey()
            .then((data) => setLicense({ configured: data.configured }))
            .catch(() => setLicense({ configured: false }));
    }, []);

    return (
        <Card withBorder padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" align="center">
                    <Stack gap={2}>
                        <Title order={4}>Plugin configuration</Title>
                        <Text size="sm" c="dimmed">
                            These settings affect the SurveyJS plugin as a whole, not one survey.
                        </Text>
                    </Stack>
                    {license === null ? (
                        <Loader size="xs" />
                    ) : license.configured ? (
                        <Badge color="green" variant="light">License configured</Badge>
                    ) : (
                        <Badge color="yellow" variant="light">License not configured</Badge>
                    )}
                </Group>

                {license !== null && !license.configured && (
                    <Alert color="yellow" title="SurveyJS license">
                        Set <Code>SURVEYJS_LICENSE_KEY</Code> in the backend environment to remove the
                        SurveyJS watermark from the Designer and runtime forms.
                    </Alert>
                )}

                <Paper withBorder p="md">
                    <Stack gap={4}>
                        <Text fw={600}>Developer live reload</Text>
                        <Text size="sm" c="dimmed">
                            One-time backend attach registers routes, tables, permissions, and the bundle. Keep
                            the runtime server open while editing plugin UI code.
                        </Text>
                        <Code block>
                            node scripts/install-local.mjs --symlink{'\n'}
                            npm --prefix frontend run dev:runtime
                        </Code>
                        <Text size="xs" c="dimmed">
                            Full docs: <Code>plugins/sh2-shp-survey-js/docs/install.md</Code> and{' '}
                            <Code>sh-selfhelp_backend/docs/plugins/runtime-frontend-loading.md</Code>
                        </Text>
                    </Stack>
                </Paper>
            </Stack>
        </Card>
    );
}

interface INewSurveyModalProps {
    opened: boolean;
    onClose: () => void;
    onCreated: (createdId: number) => Promise<void>;
}

function NewSurveyModal({ opened, onClose, onCreated }: INewSurveyModalProps): React.ReactElement {
    const [name, setName] = useState<string>('');
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!opened) {
            setName('');
            setError(null);
            setSubmitting(false);
        }
    }, [opened]);

    const submit = async (): Promise<void> => {
        setError(null);
        if (name.trim() === '') {
            setError('Name is required.');
            return;
        }
        setSubmitting(true);
        try {
            const created = await createSurvey({
                name: name.trim(),
                definition: { pages: [] },
            });
            await onCreated(created.id);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal opened={opened} onClose={onClose} title="New survey" centered>
            <Stack gap="sm">
                <TextInput
                    label="Name"
                    placeholder="Customer feedback Q3"
                    required
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    disabled={submitting}
                />
                <Text size="sm" c="dimmed">
                    SelfHelp will generate a stable survey ID automatically. You can rename the survey and
                    change its theme later from Settings.
                </Text>
                {error && (
                    <Alert color="red" title="Could not create survey">
                        {error}
                    </Alert>
                )}
                <Group justify="flex-end" gap="xs">
                    <Button variant="default" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={() => void submit()} loading={submitting}>
                        Create &amp; Open Designer
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

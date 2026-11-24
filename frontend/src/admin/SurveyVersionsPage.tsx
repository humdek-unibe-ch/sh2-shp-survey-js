/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey Versions tab.
 *
 * Lists every published `survey_versions` row for the selected
 * survey, lets the operator restore another version (it becomes the
 * current one again and the draft is reset to it; no new version is
 * made), and compares two revisions
 * side-by-side via a structural diff. Each row shows the SHA-256 of
 * the stored definition so external audits can match a CI pipeline's
 * snapshot to the live revision.
 *
 * Comparison strategy: the operator picks a "base" and a "compare"
 * version with the row checkboxes; the page loads the two definitions
 * via `getVersion()` and renders the diff in a modal. Diff logic is
 * shared with the Designer header through `computeDefinitionDiff` so
 * the change-count semantics stay consistent across the UI.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    Code,
    Group,
    Loader,
    ScrollArea,
    Stack,
    Table,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { IconGitCompare, IconHistory, IconRefresh, IconRestore } from '@tabler/icons-react';

import {
    getVersion,
    listVersions,
    restoreVersion,
    type IAdminSurveyVersion,
    type IAdminSurveyVersionDetail,
} from '../api/surveys-admin';
import {
    computeDefinitionDiff,
    formatChangeSummary,
    type IDefinitionDiffEntry,
} from './definitionDiff';
import { AdminModal } from './ui/AdminUi';

export interface ISurveyVersionsPageProps {
    surveyId?: number;
    /** Whether the caller may publish, which restoring is. */
    canRestore?: boolean;
    /** The version participants get; restoring points it at another version. */
    currentRevision?: number | null;
    onRestored?: () => void;
}

interface ICompareState {
    baseId: number | null;
    targetId: number | null;
}

export function SurveyVersionsPage({ surveyId, canRestore = false, currentRevision = null, onRestored }: ISurveyVersionsPageProps = {}): React.ReactElement {
    const [versions, setVersions] = useState<IAdminSurveyVersion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [pendingRestore, setPendingRestore] = useState<IAdminSurveyVersion | null>(null);
    // A refused restore is told in its dialog, which stays open.
    const [restoreError, setRestoreError] = useState<string | null>(null);
    const [compareState, setCompareState] = useState<ICompareState>({ baseId: null, targetId: null });
    const [compareModalOpen, setCompareModalOpen] = useState<boolean>(false);
    const [compareLoading, setCompareLoading] = useState<boolean>(false);
    const [compareError, setCompareError] = useState<string | null>(null);
    const [compareData, setCompareData] = useState<{
        base: IAdminSurveyVersionDetail;
        target: IAdminSurveyVersionDetail;
        entries: IDefinitionDiffEntry[];
        summary: string;
    } | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        if (!surveyId) return;
        setError(null);
        try {
            const list = await listVersions(surveyId);
            setVersions(list);
        } catch (err) {
            setError((err as Error).message);
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const confirmRestore = useCallback(async (): Promise<void> => {
        if (!surveyId || !pendingRestore) return;
        setBusy(true);
        setRestoreError(null);
        try {
            await restoreVersion(surveyId, pendingRestore.id);
            setPendingRestore(null);
            await reload();
            onRestored?.();
        } catch (err) {
            setRestoreError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [onRestored, pendingRestore, reload, surveyId]);

    const toggleCompareSelection = useCallback((versionId: number): void => {
        setCompareState((prev) => {
            if (prev.baseId === versionId) {
                return { baseId: null, targetId: prev.targetId };
            }
            if (prev.targetId === versionId) {
                return { baseId: prev.baseId, targetId: null };
            }
            if (prev.baseId === null) {
                return { ...prev, baseId: versionId };
            }
            if (prev.targetId === null) {
                return { ...prev, targetId: versionId };
            }
            return { baseId: prev.targetId, targetId: versionId };
        });
    }, []);

    const canCompare = compareState.baseId !== null && compareState.targetId !== null
        && compareState.baseId !== compareState.targetId;

    const openCompare = useCallback(async (): Promise<void> => {
        if (!surveyId || !canCompare) return;
        const baseId = compareState.baseId;
        const targetId = compareState.targetId;
        if (baseId === null || targetId === null) return;
        setCompareLoading(true);
        setCompareError(null);
        setCompareModalOpen(true);
        try {
            const [base, target] = await Promise.all([
                getVersion(surveyId, baseId),
                getVersion(surveyId, targetId),
            ]);
            const diff = computeDefinitionDiff(base.definition, target.definition);
            setCompareData({
                base,
                target,
                entries: diff.entries,
                summary: formatChangeSummary(diff),
            });
        } catch (err) {
            setCompareError((err as Error).message);
            setCompareData(null);
        } finally {
            setCompareLoading(false);
        }
    }, [canCompare, compareState.baseId, compareState.targetId, surveyId]);

    const selectionSummary = useMemo((): string => {
        if (compareState.baseId === null && compareState.targetId === null) {
            return 'Select two versions to compare';
        }
        const labelFor = (id: number | null): string => {
            if (id === null) return '?';
            const v = versions?.find((x) => x.id === id);
            return v ? `v${v.revision}` : `#${id}`;
        };
        if (compareState.baseId !== null && compareState.targetId === null) {
            return `Base: ${labelFor(compareState.baseId)}. Select a second version to compare.`;
        }
        if (compareState.baseId === null && compareState.targetId !== null) {
            return `Compare: ${labelFor(compareState.targetId)}. Select a base version.`;
        }
        return `Comparing ${labelFor(compareState.baseId)} → ${labelFor(compareState.targetId)}`;
    }, [compareState.baseId, compareState.targetId, versions]);

    if (!surveyId) {
        return (
            <Card withBorder p="lg">
                <Stack gap="xs" align="center">
                    <IconHistory size={32} />
                    <Title order={4}>No survey selected</Title>
                    <Text c="dimmed" size="sm">
                        Pick a survey to inspect its version history.
                    </Text>
                </Stack>
            </Card>
        );
    }

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Stack gap={2}>
                    <Title order={2} size="h4">Version history</Title>
                    <Text size="sm" c="dimmed">
                        Each publish creates a version that never changes. Tick two versions to see what
                        changed between them{canRestore ? '; restore one to make it the version participants get' : ''}.
                    </Text>
                </Stack>
                <Group gap="xs">
                    <Tooltip label="Reload version list">
                        <Button
                            variant="subtle"
                            leftSection={<IconRefresh size={14} />}
                            onClick={() => void reload()}
                        >
                            Reload
                        </Button>
                    </Tooltip>
                    <Tooltip label={canCompare ? 'Open structural diff' : selectionSummary}>
                        <Button
                            leftSection={<IconGitCompare size={14} />}
                            disabled={!canCompare}
                            onClick={() => void openCompare()}
                        >
                            Compare selected
                        </Button>
                    </Tooltip>
                </Group>
            </Group>
            {error && (
                <Alert color="red" title="Could not load versions">
                    {error}
                </Alert>
            )}
            {versions === null ? (
                <Group justify="center" py="md" gap="xs">
                    <Loader size="sm" />
                    <Text size="sm">Loading versions…</Text>
                </Group>
            ) : versions.length === 0 ? (
                <Alert color="gray" title="No published versions yet">
                    Publish the survey from the Design tab to create the first version.
                </Alert>
            ) : (
                <div className="sjs-admin-table">
                    <Group justify="space-between" px="md" py="xs">
                        <Text size="sm" c="dimmed">{selectionSummary}</Text>
                        {(compareState.baseId !== null || compareState.targetId !== null) && (
                            <Button
                                variant="subtle"
                                size="compact-xs"
                                onClick={() => setCompareState({ baseId: null, targetId: null })}
                            >
                                Clear selection
                            </Button>
                        )}
                    </Group>
                    <Table verticalSpacing="sm" highlightOnHover>
                        <Table.Thead className="sjs-admin-table__head">
                            <Table.Tr>
                                <Table.Th style={{ width: 60 }}>Compare</Table.Th>
                                <Table.Th>Revision</Table.Th>
                                <Table.Th>Published at</Table.Th>
                                <Table.Th>By</Table.Th>
                                <Table.Th>SHA-256</Table.Th>
                                <Table.Th style={{ width: 110 }} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {versions.map((version) => {
                                const isBase = compareState.baseId === version.id;
                                const isTarget = compareState.targetId === version.id;
                                return (
                                    <Table.Tr key={version.id}>
                                        <Table.Td>
                                            <Checkbox
                                                checked={isBase || isTarget}
                                                onChange={() => toggleCompareSelection(version.id)}
                                                aria-label={`Select v${version.revision} for comparison`}
                                            />
                                            {isBase && <Badge size="xs" color="blue" variant="light">base</Badge>}
                                            {isTarget && <Badge size="xs" color="orange" variant="light">target</Badge>}
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap="xs">
                                                <Badge variant="light">v{version.revision}</Badge>
                                                {version.revision === currentRevision && <Badge color="green" variant="light">current</Badge>}
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm">{new Date(version.createdAt).toLocaleString()}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" c="dimmed">
                                                {version.createdByUserId === null
                                                    ? 'system'
                                                    : `user #${version.createdByUserId}`}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={version.definitionSha256}>
                                                <Code style={{ fontSize: 11 }}>
                                                    {version.definitionSha256.slice(0, 12)}…
                                                </Code>
                                            </Tooltip>
                                        </Table.Td>
                                        <Table.Td>
                                            {version.revision !== currentRevision && canRestore && (
                                                <Button
                                                    size="xs"
                                                    variant="light"
                                                    leftSection={<IconRestore size={14} />}
                                                    onClick={() => setPendingRestore(version)}
                                                >
                                                    Restore
                                                </Button>
                                            )}
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                </div>
            )}
            <AdminModal
                opened={pendingRestore !== null}
                onClose={() => {
                    setPendingRestore(null);
                    setRestoreError(null);
                }}
                title={pendingRestore ? `Restore v${pendingRestore.revision}?` : 'Restore version'}
                size="md"
                onSave={() => void confirmRestore()}
                saveLabel={pendingRestore ? `Make v${pendingRestore.revision} current` : 'Restore'}
                isLoading={busy}
            >
                <Text size="sm">
                    Participants get v{pendingRestore?.revision} again from now on, and the editor is reset
                    to it. Unsaved or unpublished changes in the editor are replaced. The other versions
                    stay in the history, and answers already given keep the version they were given with.
                </Text>
                {restoreError && (
                    <Alert color="red" title="Could not restore" mt="sm">
                        {restoreError}
                    </Alert>
                )}
            </AdminModal>
            <AdminModal
                opened={compareModalOpen}
                onClose={() => { setCompareModalOpen(false); setCompareData(null); setCompareError(null); }}
                title={
                    compareData
                        ? `Compare v${compareData.base.revision} → v${compareData.target.revision}`
                        : 'Compare versions'
                }
                size="xl"
                cancelLabel="Close"
            >
                <Stack gap="md">
                    {compareLoading ? (
                        <Group justify="center" py="md" gap="xs">
                            <Loader size="sm" />
                            <Text size="sm">Loading definitions…</Text>
                        </Group>
                    ) : compareError ? (
                        <Alert color="red" title="Could not compare versions">{compareError}</Alert>
                    ) : compareData ? (
                        <>
                            <Group gap="xs">
                                <Badge color="blue" variant="light">base v{compareData.base.revision}</Badge>
                                <Text size="sm" c="dimmed">{new Date(compareData.base.createdAt).toLocaleString()}</Text>
                                <Text size="sm">→</Text>
                                <Badge color="orange" variant="light">target v{compareData.target.revision}</Badge>
                                <Text size="sm" c="dimmed">{new Date(compareData.target.createdAt).toLocaleString()}</Text>
                            </Group>
                            <Text size="sm">{compareData.summary}</Text>
                            {compareData.entries.length === 0 ? (
                                <Alert color="green" title="Identical">
                                    Both definitions are structurally identical.
                                </Alert>
                            ) : (
                                <ScrollArea h={420}>
                                    <Table verticalSpacing="xs" striped>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Type</Table.Th>
                                                <Table.Th>Where</Table.Th>
                                                <Table.Th>What</Table.Th>
                                                <Table.Th>Detail</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {compareData.entries.map((entry, idx) => (
                                                <Table.Tr key={`${entry.path}-${idx}`}>
                                                    <Table.Td>
                                                        <DiffKindBadge kind={entry.kind} />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Code style={{ fontSize: 11 }}>{entry.path}</Code>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text size="sm">{entry.label}</Text>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text size="xs" c="dimmed">{entry.detail ?? ''}</Text>
                                                        {entry.kind === 'settings' && (
                                                            <Stack gap={2}>
                                                                <Text size="xs" c="red">
                                                                    -{' '}
                                                                    <Code style={{ fontSize: 10 }}>
                                                                        {JSON.stringify(entry.oldValue)?.slice(0, 80)}
                                                                    </Code>
                                                                </Text>
                                                                <Text size="xs" c="teal">
                                                                    +{' '}
                                                                    <Code style={{ fontSize: 10 }}>
                                                                        {JSON.stringify(entry.newValue)?.slice(0, 80)}
                                                                    </Code>
                                                                </Text>
                                                            </Stack>
                                                        )}
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                </ScrollArea>
                            )}
                        </>
                    ) : null}
                </Stack>
            </AdminModal>
        </Stack>
    );
}

function DiffKindBadge({ kind }: { kind: IDefinitionDiffEntry['kind'] }): React.ReactElement {
    switch (kind) {
        case 'added':
            return <Badge color="green" variant="light">added</Badge>;
        case 'removed':
            return <Badge color="red" variant="light">removed</Badge>;
        case 'modified':
            return <Badge color="orange" variant="light">modified</Badge>;
        case 'moved':
            return <Badge color="blue" variant="light">moved</Badge>;
        case 'settings':
            return <Badge color="violet" variant="light">setting</Badge>;
        default:
            return <Badge variant="light">{kind}</Badge>;
    }
}

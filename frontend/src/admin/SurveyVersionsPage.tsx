/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey Versions tab.
 *
 * Lists every published `survey_versions` row for the selected
 * survey, lets the operator restore an older revision (publishes it
 * as the new current version), and prints the SHA-256 of the stored
 * definition so external audits can match a CI pipeline's snapshot
 * to the live revision.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Card,
    Code,
    Group,
    Loader,
    Modal,
    Stack,
    Table,
    Text,
    Title,
    Tooltip,
} from '@mantine/core';
import { IconHistory, IconRefresh, IconRestore } from '@tabler/icons-react';

import { listVersions, restoreVersion, type IAdminSurveyVersion } from '../api/surveys-admin';

export interface ISurveyVersionsPageProps {
    surveyId?: number;
    onRestored?: () => void;
}

export function SurveyVersionsPage({ surveyId, onRestored }: ISurveyVersionsPageProps = {}): React.ReactElement {
    const [versions, setVersions] = useState<IAdminSurveyVersion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [pendingRestore, setPendingRestore] = useState<IAdminSurveyVersion | null>(null);

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
        try {
            await restoreVersion(surveyId, pendingRestore.id);
            setPendingRestore(null);
            await reload();
            onRestored?.();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }, [onRestored, pendingRestore, reload, surveyId]);

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
                <Title order={4}>Version history</Title>
                <Tooltip label="Reload">
                    <Button
                        variant="subtle"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => void reload()}
                    >
                        Reload
                    </Button>
                </Tooltip>
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
                    Publish the survey from the Designer to create the first revision.
                </Alert>
            ) : (
                <Card withBorder p={0}>
                    <Table verticalSpacing="sm" striped highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Revision</Table.Th>
                                <Table.Th>Published at</Table.Th>
                                <Table.Th>By</Table.Th>
                                <Table.Th>SHA-256</Table.Th>
                                <Table.Th style={{ width: 110 }} />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {versions.map((version, idx) => (
                                <Table.Tr key={version.id}>
                                    <Table.Td>
                                        <Group gap="xs">
                                            <Badge variant="light">v{version.revision}</Badge>
                                            {idx === 0 && <Badge color="green" variant="light">current</Badge>}
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
                                        {idx !== 0 && (
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
                            ))}
                        </Table.Tbody>
                    </Table>
                </Card>
            )}
            <Modal
                opened={pendingRestore !== null}
                onClose={() => setPendingRestore(null)}
                title={pendingRestore ? `Restore v${pendingRestore.revision}?` : ''}
                centered
            >
                <Stack gap="sm">
                    <Text size="sm">
                        Restoring will publish the definition stored in v{pendingRestore?.revision} as a
                        new current revision. Existing responses remain attached to the revision they
                        were collected against.
                    </Text>
                    <Group justify="flex-end" gap="xs">
                        <Button variant="default" onClick={() => setPendingRestore(null)} disabled={busy}>
                            Cancel
                        </Button>
                        <Button onClick={() => void confirmRestore()} loading={busy}>
                            Restore
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The Usage tab: the pages a survey is placed on, from the host (pages the
 * caller may open; the others are only counted). Built like the Versions
 * tab next to it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Group, Loader, Stack, Table, Text, Title, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconPencil, IconRefresh } from '@tabler/icons-react';

import { getSurvey, type IAdminSurveyUsage } from '../api/surveys-admin';

interface ISurveyUsagePageProps {
    surveyId: number;
}

function pagesText(count: number): string {
    return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

/** The page editor, opened on the section. */
export function sectionEditorUrl(keyword: string, sectionId: number): string {
    return `/admin/pages/${encodeURIComponent(keyword)}/${sectionId}`;
}

export function SurveyUsagePage({ surveyId }: ISurveyUsagePageProps): React.ReactElement {
    const [usage, setUsage] = useState<IAdminSurveyUsage | null>(null);
    const [archived, setArchived] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        setError(null);
        try {
            const survey = await getSurvey(surveyId);
            setArchived(survey.archived);
            setUsage(survey.usage ?? { pages: [], hiddenPages: 0 });
        } catch (err) {
            setError((err as Error).message);
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return (
        <Stack gap="md">
            <Group justify="space-between">
                <Stack gap={2}>
                    <Title order={2} size="h4">Usage</Title>
                    <Text size="sm" c="dimmed">
                        The pages that show this survey, as saved in the page editor. A section reused on other
                        pages through a reference container is not listed.
                    </Text>
                </Stack>
                <Tooltip label="Reload the pages">
                    <Button variant="subtle" leftSection={<IconRefresh size={14} />} onClick={() => void reload()}>
                        Reload
                    </Button>
                </Tooltip>
            </Group>
            {archived && (
                <Alert color="yellow" title="This survey is archived">
                    No page shows it to participants until it is unarchived in the survey list.
                </Alert>
            )}
            {error && (
                <Alert color="red" title="Could not load the usage">
                    {error}
                </Alert>
            )}
            {usage === null ? (
                !error && (
                    <Group justify="center" py="md" gap="xs">
                        <Loader size="sm" />
                        <Text size="sm">Loading the pages…</Text>
                    </Group>
                )
            ) : usage.pages.length === 0 && usage.hiddenPages === 0 ? (
                <Alert color="gray" title="Not placed on any page">
                    Add a SurveyJS section to a page in the page editor and choose this survey to show it to
                    participants.
                </Alert>
            ) : usage.pages.length === 0 ? (
                <Alert color="gray" title={`Placed on ${pagesText(usage.hiddenPages)} you cannot open`}>
                    You may not open these pages in the admin, so they are not listed. Ask an administrator for the
                    view grant on them.
                </Alert>
            ) : (
                <div className="sjs-admin-table">
                    {usage.pages.length > 0 && (
                        <Table verticalSpacing="sm" highlightOnHover>
                            <Table.Thead className="sjs-admin-table__head">
                                <Table.Tr>
                                    <Table.Th>Page</Table.Th>
                                    <Table.Th>Section</Table.Th>
                                    <Table.Th>State</Table.Th>
                                    <Table.Th>
                                        <VisuallyHidden>Actions</VisuallyHidden>
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {usage.pages.map((page) => (
                                    <Table.Tr key={`${page.pageId}-${page.sectionId}`}>
                                        <Table.Td>
                                            <Anchor href={`/admin/pages/${encodeURIComponent(page.keyword)}`} size="sm" fw={500}>
                                                {page.keyword}
                                            </Anchor>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={`Section ID: ${page.sectionId}`}>
                                                <Anchor href={sectionEditorUrl(page.keyword, page.sectionId)} size="sm">
                                                    {page.sectionName !== '' ? page.sectionName : `Section ${page.sectionId}`}
                                                </Anchor>
                                            </Tooltip>
                                        </Table.Td>
                                        <Table.Td>
                                            {page.isPublished ? (
                                                <Badge color="green" variant="light">Published</Badge>
                                            ) : (
                                                <Badge color="yellow" variant="light">Not published</Badge>
                                            )}
                                        </Table.Td>
                                        <Table.Td className="sjs-admin-table__actions">
                                            <Group gap={4} wrap="nowrap" justify="flex-end">
                                                <Tooltip label="Open the section in the page editor">
                                                    <ActionIcon
                                                        component="a"
                                                        href={sectionEditorUrl(page.keyword, page.sectionId)}
                                                        variant="subtle"
                                                        color="gray"
                                                        aria-label={`Open the section on ${page.keyword} in the page editor`}
                                                    >
                                                        <IconPencil size={16} />
                                                    </ActionIcon>
                                                </Tooltip>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    )}
                    <Group className="sjs-admin-table__footer">
                        <Text size="sm" c="dimmed">
                            {usage.pages.length} {usage.pages.length === 1 ? 'section' : 'sections'}
                            {usage.hiddenPages > 0 && `, and ${pagesText(usage.hiddenPages)} you cannot open`}
                        </Text>
                    </Group>
                </div>
            )}
        </Stack>
    );
}

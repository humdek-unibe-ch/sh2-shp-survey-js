/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * One survey: a compact header (back, name, state, ID) and a tab per task
 * (design, answers, versions, settings). The Design tab stays mounted once opened, so moving
 * to another tab and back keeps unsaved edits in the editor. Its save and
 * publish bar sits at the right of the tab row, so the editor below keeps
 * as much of the screen as it can.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Box, Button, CopyButton, Group, Loader, Stack, Tabs, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconChartBar, IconCheck, IconCopy, IconDatabase, IconHistory, IconLayoutList, IconPencil, IconSettings } from '@tabler/icons-react';

import { getSurvey, SurveyApiError, type IAdminSurveyDetail } from '../api/surveys-admin';
import type { TSurveyView } from './adminUrl';
import { dataScreenUrl } from './dataScreenUrl';
import { SurveyAnswersPage } from './SurveyAnswersPage';
import { SurveyDesignerPage } from './SurveyDesignerPage';
import { SurveySettingsPage } from './SurveySettingsPage';
import { SurveyUsagePage } from './SurveyUsagePage';
import { SurveyVersionsPage } from './SurveyVersionsPage';

interface ISurveyDetailPageProps {
    surveyId: number;
    view: TSurveyView;
    onViewChange: (view: TSurveyView) => void;
    onBack: () => void;
}

export function SurveyDetailPage({ surveyId, view, onViewChange, onBack }: ISurveyDetailPageProps): React.ReactElement {
    const [survey, setSurvey] = useState<IAdminSurveyDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [designOpened, setDesignOpened] = useState<boolean>(view === 'design');
    // A restored version replaces the draft: the editor is rebuilt on it.
    const [designerKey, setDesignerKey] = useState<number>(0);
    const [designActions, setDesignActions] = useState<HTMLDivElement | null>(null);

    const reload = useCallback(async (): Promise<void> => {
        try {
            setSurvey(await getSurvey(surveyId));
        } catch (err) {
            if (err instanceof SurveyApiError && err.status === 404) {
                setError('This survey does not exist. It may have been deleted.');
            } else if (err instanceof SurveyApiError && err.status === 403) {
                setError('This survey is not shared with your roles.');
            } else {
                setError((err as Error).message);
            }
        }
    }, [surveyId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    useEffect(() => {
        if (view === 'design') setDesignOpened(true);
    }, [view]);

    const back = (
        <Anchor component="button" type="button" onClick={onBack} size="sm" w="fit-content">
            <Group gap={4}>
                <IconArrowLeft size={14} />
                All surveys
            </Group>
        </Anchor>
    );

    if (error) {
        return (
            <Stack gap="md">
                {back}
                <Alert color="red" title="Could not open the survey">
                    {error}
                </Alert>
            </Stack>
        );
    }
    if (survey === null) {
        return (
            <Stack gap="md">
                {back}
                <Group gap="xs" justify="center" py="xl">
                    <Loader size="sm" />
                    <Text>Loading the survey…</Text>
                </Group>
            </Stack>
        );
    }

    return (
        <Stack gap="sm" className="sjs-admin-fill">
            <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap="sm" wrap="nowrap" miw={0}>
                    <Button variant="subtle" onClick={onBack} leftSection={<IconArrowLeft size="1rem" />} style={{ flexShrink: 0 }}>
                        All surveys
                    </Button>
                    <Title order={2} lineClamp={1} miw={0}>
                        {survey.name}
                    </Title>
                    {survey.archived && <Badge color="gray" variant="light" style={{ flexShrink: 0 }}>Archived</Badge>}
                    {survey.currentRevision === null ? (
                        <Badge color="yellow" variant="light" style={{ flexShrink: 0 }}>Not published yet</Badge>
                    ) : (
                        <Badge color="green" variant="light" style={{ flexShrink: 0 }}>Published v{survey.currentRevision}</Badge>
                    )}
                    <Group gap={2} wrap="nowrap" visibleFrom="md" style={{ flexShrink: 0 }}>
                        <Text size="sm" c="dimmed" ff="monospace">{survey.surveyId}</Text>
                        <CopyButton value={survey.surveyId} timeout={1500}>
                            {({ copied, copy }) => (
                                <Tooltip label={copied ? 'Copied' : 'Copy survey ID'} withArrow>
                                    <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} size="sm" onClick={copy} aria-label="Copy survey ID">
                                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                                    </ActionIcon>
                                </Tooltip>
                            )}
                        </CopyButton>
                    </Group>
                </Group>
                {survey.dataTableId !== null && (
                    <Button
                        component="a"
                        href={dataScreenUrl(survey.dataTableId)}
                        variant="light"
                        size="sm"
                        leftSection={<IconDatabase size={16} />}
                        style={{ flexShrink: 0 }}
                    >
                        Answers in Data screen
                    </Button>
                )}
            </Group>

            <Tabs
                value={view}
                onChange={(next) => next && onViewChange(next as TSurveyView)}
                keepMounted={false}
                className="sjs-admin-fill"
            >
                <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs" className="sjs-detail-tabs">
                    <Tabs.List className="sjs-detail-tabs__list">
                        <Tabs.Tab value="design" leftSection={<IconPencil size={14} />}>
                            Design
                        </Tabs.Tab>
                        <Tabs.Tab value="answers" leftSection={<IconChartBar size={14} />}>
                            Answers{survey.responseCount !== null ? ` (${survey.responseCount})` : ''}
                        </Tabs.Tab>
                        <Tabs.Tab value="versions" leftSection={<IconHistory size={14} />}>
                            Versions
                        </Tabs.Tab>
                        <Tabs.Tab value="usage" leftSection={<IconLayoutList size={14} />}>
                            Usage
                        </Tabs.Tab>
                        <Tabs.Tab value="settings" leftSection={<IconSettings size={14} />}>
                            Settings
                        </Tabs.Tab>
                    </Tabs.List>
                    <Box ref={setDesignActions} hidden={view !== 'design'} pb={6} />
                </Group>
                <Tabs.Panel value="design" pt="sm" keepMounted={designOpened} className="sjs-admin-fill">
                    {designOpened && (
                        <SurveyDesignerPage key={designerKey} survey={survey} onSurveyChanged={setSurvey} actionsTarget={designActions} />
                    )}
                </Tabs.Panel>
                <Tabs.Panel value="answers" pt="md">
                    <SurveyAnswersPage survey={survey} />
                </Tabs.Panel>
                <Tabs.Panel value="versions" pt="md">
                    <SurveyVersionsPage
                        surveyId={survey.id}
                        canRestore={survey.rights.publish}
                        currentRevision={survey.currentRevision}
                        // Rebuild the editor only once the restored draft is loaded, or it starts from the old one.
                        onRestored={() => void reload().then(() => setDesignerKey((key) => key + 1))}
                    />
                </Tabs.Panel>
                <Tabs.Panel value="usage" pt="md">
                    <SurveyUsagePage surveyId={survey.id} />
                </Tabs.Panel>
                <Tabs.Panel value="settings" pt="md">
                    <SurveySettingsPage survey={survey} onSurveyChanged={setSurvey} />
                </Tabs.Panel>
            </Tabs>
        </Stack>
    );
}

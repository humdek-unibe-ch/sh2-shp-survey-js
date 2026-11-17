/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Theme test page: every SurveyJS question type next to real Mantine
 * controls, in light and dark and with any primary colour. Runs on its
 * own (`npm run dev:theme`), without a SelfHelp host or backend, and
 * loads the same stylesheets the plugin ships.
 *
 * URL parameters, so a screenshot test can open a fixed state:
 * `scheme=light|dark`, `primary=<mantine colour>`, `page=<number>`,
 * `single=1` (all pages on one), `errors=1` (validate on load),
 * `view=creator` (the same survey in the Creator), `view=dashboard`
 * (charts over a few made-up responses).
 */

import '@mantine/core/styles.css';
import 'survey-core/survey-core.css';
import 'survey-creator-core/survey-creator-core.css';
import 'survey-analytics/survey.analytics.min.css';
import '../src/theme/mantine-adapter.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Button,
    Checkbox,
    Container,
    Group,
    MantineProvider,
    Paper,
    Radio,
    SegmentedControl,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    Textarea,
    Title,
    createTheme,
    useMantineColorScheme,
} from '@mantine/core';
import { Model, Serializer } from 'survey-core';
import { Survey } from 'survey-react-ui';
import { SurveyCreator, SurveyCreatorComponent } from 'survey-creator-react';
import { VisualizationPanel } from 'survey-analytics';

import { applyMantineSurveyDefaults } from '../src/theme/surveyDefaults';
import { ALL_QUESTION_TYPES_SURVEY } from './allQuestionTypes';

const PRIMARY_COLORS = ['blue', 'teal', 'violet', 'orange', 'red'];
const params = new URLSearchParams(window.location.search);

applyMantineSurveyDefaults(Serializer);

function ThemeTestPage({ primary, onPrimaryChange }: { primary: string; onPrimaryChange: (value: string) => void }): React.ReactElement {
    const { colorScheme, setColorScheme } = useMantineColorScheme();

    const model = useMemo(() => {
        const survey = new Model(ALL_QUESTION_TYPES_SURVEY);
        survey.elementIdPrefix = 'theme-test-';
        if (params.get('single') === '1') {
            survey.questionsOnPageMode = 'singlePage';
        }
        const page = Number(params.get('page') ?? '0');
        if (page > 0) {
            survey.currentPageNo = page;
        }
        return survey;
    }, []);

    useEffect(() => {
        if (params.get('errors') === '1') {
            model.validate(true);
        }
    }, [model]);

    return (
        <Container size="md" py="xl">
            <Stack gap="lg">
                <Group justify="space-between">
                    <Title order={2}>SurveyJS theme test page</Title>
                    <Group>
                        <SegmentedControl
                            aria-label="Color scheme"
                            value={colorScheme === 'dark' ? 'dark' : 'light'}
                            onChange={(value) => setColorScheme(value as 'light' | 'dark')}
                            data={['light', 'dark']}
                        />
                        <Select
                            aria-label="Primary color"
                            value={primary}
                            onChange={(value) => onPrimaryChange(value ?? 'blue')}
                            data={PRIMARY_COLORS}
                            allowDeselect={false}
                            w={120}
                        />
                    </Group>
                </Group>

                <Paper withBorder p="md">
                    <Stack gap="sm">
                        <Text fw={500}>Mantine reference controls</Text>
                        <Group grow align="flex-start">
                            <TextInput label="Text input" description="Description" placeholder="Placeholder" />
                            <TextInput label="With error" error="This field is required" withAsterisk />
                            <Select label="Select" placeholder="Pick one" data={['First option', 'Second option']} />
                        </Group>
                        <Textarea label="Textarea" placeholder="Several lines of text" />
                        <Group>
                            <Checkbox label="Checkbox" defaultChecked />
                            <Radio label="Radio" defaultChecked />
                            <Switch label="Switch" defaultChecked />
                            <Button>Primary</Button>
                            <Button variant="default">Default</Button>
                            <Button variant="light">Light</Button>
                        </Group>
                    </Stack>
                </Paper>

                <Survey model={model} />
            </Stack>
        </Container>
    );
}

function CreatorTestPage(): React.ReactElement {
    const creator = useMemo(() => {
        const instance = new SurveyCreator({ showThemeTab: false, showJSONEditorTab: true });
        instance.JSON = ALL_QUESTION_TYPES_SURVEY;
        return instance;
    }, []);
    return (
        <div style={{ height: '100vh' }}>
            <SurveyCreatorComponent creator={creator} />
        </div>
    );
}

const DASHBOARD_RESPONSES = [
    { radiogroup: 'First option', checkbox: ['First option', 'Second option'], rating_numbers: 4, boolean_switch: true },
    { radiogroup: 'Second option', checkbox: ['First option'], rating_numbers: 5, boolean_switch: false },
    { radiogroup: 'First option', checkbox: ['Third option'], rating_numbers: 2, boolean_switch: true },
];

function DashboardTestPage(): React.ReactElement {
    const containerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!containerRef.current) return undefined;
        const questions = new Model(ALL_QUESTION_TYPES_SURVEY)
            .getAllQuestions()
            .filter((question) => ['radiogroup', 'checkbox', 'rating_numbers', 'boolean_switch'].includes(question.name));
        const panel = new VisualizationPanel(questions, DASHBOARD_RESPONSES, { allowDynamicLayout: false });
        panel.render(containerRef.current);
        return () => panel.destroy();
    }, []);
    return (
        <Container size="lg" py="xl">
            <div ref={containerRef} className="sd-theme-root sjs-theme-overrides" />
        </Container>
    );
}

function App(): React.ReactElement {
    const [primary, setPrimary] = useState<string>(params.get('primary') ?? 'blue');
    const theme = useMemo(() => createTheme({ primaryColor: primary }), [primary]);
    const scheme = params.get('scheme') === 'dark' ? 'dark' : 'light';
    return (
        <MantineProvider theme={theme} forceColorScheme={params.has('scheme') ? scheme : undefined} defaultColorScheme="light">
            {params.get('view') === 'creator' && <CreatorTestPage />}
            {params.get('view') === 'dashboard' && <DashboardTestPage />}
            {!params.has('view') && <ThemeTestPage primary={primary} onPrimaryChange={setPrimary} />}
        </MantineProvider>
    );
}

const root = document.getElementById('root');
if (root) {
    createRoot(root).render(<App />);
}

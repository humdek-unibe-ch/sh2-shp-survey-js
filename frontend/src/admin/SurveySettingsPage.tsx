/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Plugin-level settings page.
 *
 * The actual feature-flag editor lives in the host's plugin detail UI;
 * this page surfaces a contextual summary so admins can jump straight
 * to the global setting from inside the SurveyJS host shell.
 */

import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Card, Code, Group, Loader, Stack, Text, Title } from '@mantine/core';

import { fetchLicenseKey } from '../api/surveys-admin';

export function SurveySettingsPage(): React.ReactElement {
    const [license, setLicense] = useState<{ configured: boolean } | null>(null);

    useEffect(() => {
        fetchLicenseKey()
            .then((data) => setLicense({ configured: data.configured }))
            .catch(() => setLicense({ configured: false }));
    }, []);

    return (
        <Stack gap="md">
            <Title order={4}>SurveyJS plugin settings</Title>

            <Card withBorder padding="lg">
                <Stack gap="xs">
                    <Group justify="space-between" align="center">
                        <Title order={5}>License key</Title>
                        {license === null ? (
                            <Loader size="xs" />
                        ) : license.configured ? (
                            <Badge color="green" variant="light">
                                Configured
                            </Badge>
                        ) : (
                            <Badge color="yellow" variant="light">
                                Not configured
                            </Badge>
                        )}
                    </Group>
                    <Text size="sm" c="dimmed">
                        Set <Code>SURVEYJS_LICENSE_KEY</Code> in the backend environment to remove the
                        SurveyJS unlicensed watermark from the runtime form and the Designer.
                    </Text>
                    {license !== null && !license.configured && (
                        <Alert color="yellow" title="Watermarked builds">
                            Without a license, the Designer and runtime show a SurveyJS branding watermark.
                            This is a SurveyJS upstream requirement, not a host policy.
                        </Alert>
                    )}
                </Stack>
            </Card>

            <Card withBorder padding="lg">
                <Stack gap="xs">
                    <Title order={5}>Feature flags</Title>
                    <Text size="sm" c="dimmed">
                        Toggle the GPX, Video, Rich-text, PDF export, Dashboard, and Collaborative-editing
                        flags from the host's{' '}
                        <Anchor href="/admin/plugins" target="_self">
                            Plugins → SurveyJS
                        </Anchor>{' '}
                        detail page. Flags propagate live to all users without a redeploy.
                    </Text>
                </Stack>
            </Card>

            <Card withBorder padding="lg">
                <Stack gap="xs">
                    <Title order={5}>Permissions</Title>
                    <Text size="sm" c="dimmed">
                        Anyone holding a role granted the following permissions can use the matching feature.
                        Future iterations will expose per-survey ACL once the host adds the primitive.
                    </Text>
                    <Stack gap={4}>
                        <Text size="sm">
                            <Code>surveyjs.surveys.manage</Code> — create / edit / publish / delete surveys,
                            access the Designer.
                        </Text>
                        <Text size="sm">
                            <Code>surveyjs.surveys.view-responses</Code> — view the Responses table and
                            Dashboard for any survey.
                        </Text>
                        <Text size="sm">
                            <Code>surveyjs.surveys.export-pdf</Code> — export survey responses as PDF.
                        </Text>
                    </Stack>
                </Stack>
            </Card>
        </Stack>
    );
}

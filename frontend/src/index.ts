/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `@humdek/sh2-shp-survey-js` — SurveyJS v2 frontend plugin entry.
 *
 * Mounted by the host `PluginRuntime` at app boot. The runtime calls
 * `register(api)`; we return an `IPluginRegistration` describing every
 * style, admin page, menu item, feature flag, realtime topic, and
 * health check we contribute.
 *
 * No top-level side effects: SurveyJS modules are imported lazily
 * inside the component bodies so a plugin disabled at runtime does
 * not pull a 1 MB bundle into the host shell.
 */

import { definePlugin } from '@selfhelp/shared/plugin-sdk';
import type { IPluginApi, IPluginRegistration } from '@selfhelp/shared/plugin-sdk';

import { SurveyJsStyle } from './styles/SurveyJsStyle';
import { GpxMapStyle } from './styles/GpxMapStyle';
import { SurveyAdminPage } from './admin/SurveyAdminPage';
import { SurveyDesignerPage } from './admin/SurveyDesignerPage';
import { SurveyResponsesPage } from './admin/SurveyResponsesPage';
import { SurveyDashboardPage } from './admin/SurveyDashboardPage';
import { SurveySettingsPage } from './admin/SurveySettingsPage';
import { setPluginApi } from './runtime/pluginApi';

export const PLUGIN_ID = 'sh2-shp-survey-js';
export const PLUGIN_VERSION = '1.0.0';

/**
 * Called by `PluginRuntime.registerOne()`. The runtime captures the
 * returned registration; the same module exports `register` as the
 * default factory expected by the host loader.
 *
 * `setPluginApi(api)` stashes the host api so deeper modules (the
 * Survey Designer page, the Tiptap-on-Creator wiring, the GPX
 * renderer, etc.) can read it without React-context plumbing.
 */
export const register = (api: IPluginApi): IPluginRegistration => {
    setPluginApi(api);
    return definePlugin({
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        pluginApiVersion: '1.0',
        styles: [
            {
                name: 'surveyjs',
                description: 'Embeds a published SurveyJS survey at runtime.',
                category: 'forms',
                frontendOnly: true,
                canHaveChildren: false,
                component: SurveyJsStyle as never,
            },
            {
                name: 'gpxMap',
                description: 'Standalone Leaflet-based map renderer for a GPX answer field.',
                category: 'media',
                frontendOnly: true,
                canHaveChildren: false,
                component: GpxMapStyle as never,
            },
        ],
        adminPages: [
            {
                slug: 'surveys',
                title: 'Surveys',
                permission: 'surveyjs.surveys.manage',
                component: SurveyAdminPage as never,
            },
            {
                slug: 'surveys/designer',
                title: 'Survey Designer',
                permission: 'surveyjs.surveys.manage',
                component: SurveyDesignerPage as never,
            },
            {
                slug: 'surveys/responses',
                title: 'Responses',
                permission: 'surveyjs.surveys.view-responses',
                component: SurveyResponsesPage as never,
            },
            {
                slug: 'surveys/dashboard',
                title: 'Dashboard',
                permission: 'surveyjs.surveys.view-responses',
                component: SurveyDashboardPage as never,
            },
            {
                slug: 'surveys/settings',
                title: 'Settings',
                permission: 'surveyjs.surveys.manage',
                component: SurveySettingsPage as never,
            },
        ],
        menuItems: [
            {
                key: 'surveyjs.surveys',
                label: 'Surveys',
                icon: 'tabler-clipboard-list',
                href: '/admin/plugins-host/sh2-shp-survey-js/surveys',
                permission: 'surveyjs.surveys.manage',
                position: { section: 'admin', order: 300 },
            },
        ],
        featureFlags: [
            { key: 'gpx', label: 'GPX question type', defaultEnabled: false },
            { key: 'video', label: 'Video question type', defaultEnabled: false },
            {
                key: 'rich-text',
                label: 'Tiptap rich-text (runtime + Creator property editors)',
                defaultEnabled: true,
            },
            { key: 'pdf-export', label: 'PDF export of responses', defaultEnabled: false },
            { key: 'dashboard', label: 'Response dashboard', defaultEnabled: true },
            {
                key: 'collab-editing',
                label: 'Collaborative-edit notifications',
                defaultEnabled: true,
            },
        ],
        realtimeTopics: [
            {
                key: 'surveys/{surveyId}/editing',
                requiredPermission: 'surveyjs.surveys.manage',
            },
            {
                key: 'surveys/{surveyId}/responses',
                requiredPermission: 'surveyjs.surveys.view-responses',
            },
        ],
        healthChecks: [
            {
                key: 'surveyjs.license',
                label: 'SurveyJS license configured',
                severity: 'warning',
                run: async () => {
                    try {
                        const res = await fetch('/cms-api/v1/admin/plugins/surveyjs/license-key', {
                            credentials: 'include',
                            headers: { Accept: 'application/json' },
                        });
                        if (!res.ok) {
                            return { status: 'warn', detail: 'License endpoint not reachable.' };
                        }
                        const body = (await res.json()) as { data?: { configured?: boolean } };
                        if (body.data?.configured) {
                            return { status: 'ok' };
                        }
                        return {
                            status: 'warn',
                            detail: 'No SURVEYJS_LICENSE_KEY set; running unlicensed.',
                        };
                    } catch (err) {
                        return {
                            status: 'warn',
                            detail: `License health check failed: ${(err as Error).message}`,
                        };
                    }
                },
            },
        ],
    });
};

export default register;

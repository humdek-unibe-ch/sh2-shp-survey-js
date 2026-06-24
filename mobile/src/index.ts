/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `@selfhelp/sh2-shp-survey-js-mobile` — mobile entry.
 *
 * Bundled into mobile builds by the host's `plugins:sync` script
 * (per EAS profile). Exports `registerMobile` which returns the
 * plugin's `IMobilePluginRegistration` — the `surveyjs` style.
 *
 * The style dispatches by platform (`styles/SurveyJsStyle`): the Expo
 * web export (react-native-web) renders the survey INTERACTIVELY with
 * the SurveyJS React library (`survey-core` + `survey-react-ui`) —
 * fetch + render + per-page progress save + submit + redirect, mirroring
 * the web frontend runtime. On native (no DOM) it falls back to the
 * read-only viewer + "Open on web".
 */

import { defineMobilePlugin } from '@selfhelp/shared/plugin-sdk';
import type { IMobilePluginRegistration } from '@selfhelp/shared/plugin-sdk';

import { SurveyJsStyle } from './styles/SurveyJsStyle';

export const PLUGIN_ID = 'sh2-shp-survey-js';
/**
 * Must match `plugin.json#version` and the mobile `package.json#version`.
 * `PluginRuntime.registerOne()` (web) and the mobile sync script both
 * compare these constants against the manifest version; a mismatch
 * silently breaks the plugin.
 */
export const PLUGIN_VERSION = '0.2.25';

export const registerMobile = (): IMobilePluginRegistration =>
    defineMobilePlugin({
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        pluginApiVersion: '0.1.0',
        styles: [
            {
                name: 'surveyjs',
                description: 'Mobile renderer for a published SurveyJS survey (interactive on web, read-only on native).',
                category: 'forms',
                canHaveChildren: false,
                component: SurveyJsStyle as never,
            },
        ],
        featureFlags: [
            { key: 'gpx', label: 'GPX question type', defaultEnabled: false },
            { key: 'video', label: 'Video question type', defaultEnabled: false },
            { key: 'rich-text', label: 'Rich-text question type', defaultEnabled: true },
        ],
    });

export default registerMobile;

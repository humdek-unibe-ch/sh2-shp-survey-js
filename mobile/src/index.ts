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
 * The style (`styles/SurveyJsStyle`) is a thin native shell that hosts the
 * OFFICIAL SurveyJS web runtime (`survey-core` + `survey-react-ui`) inside an
 * isolated, self-contained WebView — `react-native-webview` on native, an
 * `iframe` on the Expo web export — driven by a typed postMessage bridge.
 * This gives mobile full parity with the web frontend (same JSON, question
 * types, validation, conditional logic, completion, redirect). The native
 * host owns ALL authenticated API calls via `@selfhelp/shared`
 * `MobileHostServices`; the WebView never sees the access token.
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
export const PLUGIN_VERSION = '0.3.1';

export const registerMobile = (): IMobilePluginRegistration =>
    defineMobilePlugin({
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        pluginApiVersion: '0.1.0',
        styles: [
            {
                name: 'surveyjs',
                description: 'Mobile renderer for a published SurveyJS survey (official SurveyJS runtime in a WebView; full submit/validation/redirect parity with web).',
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

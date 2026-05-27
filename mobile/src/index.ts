/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `@humdek/sh2-shp-survey-js-mobile` — v1 readonly mobile entry.
 *
 * Bundled into mobile builds by the host's `plugins:sync` script
 * (per EAS profile). Exports `registerMobile` which returns the
 * plugin's `IMobilePluginRegistration` — currently just the
 * `surveyjs` style implementation that renders a published survey
 * read-only and falls back to "Open on web" for question types not
 * supported on mobile yet.
 */

import { defineMobilePlugin } from '@selfhelp/shared/plugin-sdk';
import type { IMobilePluginRegistration } from '@selfhelp/shared/plugin-sdk';

import { SurveyJsReadOnlyStyle } from './styles/SurveyJsReadOnlyStyle';

export const PLUGIN_ID = 'sh2-shp-survey-js';
/**
 * Must match `plugin.json#version` and the mobile `package.json#version`.
 * `PluginRuntime.registerOne()` (web) and the mobile sync script both
 * compare these constants against the manifest version; a mismatch
 * silently breaks the plugin.
 */
export const PLUGIN_VERSION = '0.2.8';

export const registerMobile = (): IMobilePluginRegistration =>
    defineMobilePlugin({
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        pluginApiVersion: '1.0',
        styles: [
            {
                name: 'surveyjs',
                description: 'Read-only mobile renderer for a published SurveyJS survey.',
                category: 'forms',
                frontendOnly: true,
                canHaveChildren: false,
                component: SurveyJsReadOnlyStyle as never,
            },
        ],
        featureFlags: [
            { key: 'gpx', label: 'GPX question type', defaultEnabled: false },
            { key: 'video', label: 'Video question type', defaultEnabled: false },
            { key: 'rich-text', label: 'Rich-text question type', defaultEnabled: true },
        ],
    });

export default registerMobile;

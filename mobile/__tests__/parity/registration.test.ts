/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Renderer-parity + registration snapshot for the SurveyJS mobile entry
 * (plan Slice 8D; golden workflow §19.5 "Survey lifecycle").
 *
 * The mobile package ships a *read-only* renderer for the `surveyjs`
 * style. This test certifies that the mobile registration stays in
 * parity with the single source of truth — `plugin.json` — and with the
 * web registration's style contract, without rendering React Native.
 *
 * Why parity matters: `mobile/src/index.ts` hard-codes `PLUGIN_ID` /
 * `PLUGIN_VERSION` and the host mobile sync script compares them against
 * the manifest. The file's own docblock warns that a mismatch "silently
 * breaks the plugin". This test turns that footgun into a failing build.
 *
 * Expected pre-fix failure (DoD §22 #5): bump `plugin.json#version`
 * (or `plugin.json#mobile.version`) without bumping
 * `mobile/src/index.ts#PLUGIN_VERSION` and this test goes red on the
 * "mobile version must match the manifest" assertion.
 *
 * Note: after the ecosystem 0.1.0 reconciliation, the mobile and web
 * entries both declare `pluginApiVersion: '0.1.0'` (the unified pre-release
 * SDK version the shared package exports). We *snapshot* that value rather
 * than asserting equality with the web entry — the snapshot keeps any future
 * drift visible in review.
 */

import { describe, expect, it } from 'vitest';

import manifest from '../../../plugin.json';
import { PLUGIN_ID, PLUGIN_VERSION, registerMobile } from '../../src/index';

interface IRegisteredStyle {
    name: string;
    description?: string;
    category?: string;
    frontendOnly?: boolean;
    canHaveChildren?: boolean;
}

interface IRegisteredFlag {
    key: string;
    label?: string;
    defaultEnabled?: boolean;
}

const registration = registerMobile();
const styles = (registration.styles ?? []) as IRegisteredStyle[];
const surveyStyle = styles.find((s) => s.name === 'surveyjs');

describe('SurveyJS mobile registration parity', () => {
    it('identifies as the SurveyJS plugin (constant === manifest id)', () => {
        expect(PLUGIN_ID).toBe('sh2-shp-survey-js');
        expect(registration.id).toBe(PLUGIN_ID);
        expect(registration.id).toBe(manifest.id);
    });

    it('keeps the mobile version in sync with the manifest (silently-breaks guard)', () => {
        expect(registration.version).toBe(PLUGIN_VERSION);
        expect(registration.version).toBe(manifest.version);
        expect(registration.version).toBe(manifest.mobile.version);
    });

    it('is declared read-only in the manifest (mobile renders, never submits)', () => {
        expect(manifest.mobile.readonly).toBe(true);
    });

    it('registers the read-only "surveyjs" style with the manifest style contract', () => {
        expect(surveyStyle, 'mobile must register a "surveyjs" style').toBeDefined();
        expect(surveyStyle?.frontendOnly).toBe(true);
        expect(surveyStyle?.canHaveChildren).toBe(false);
        expect(surveyStyle?.category).toBe(manifest.labels.category);

        // Parity with the manifest's declared style of the same name.
        const manifestStyle = manifest.styles.find((s) => s.name === 'surveyjs');
        expect(manifestStyle, 'plugin.json must declare a "surveyjs" style').toBeDefined();
        expect(surveyStyle?.canHaveChildren).toBe(manifestStyle?.canHaveChildren);
    });

    it('only exposes feature flags that the manifest also declares', () => {
        const manifestFlagKeys = new Set(manifest.featureFlags.map((f) => f.key));
        const mobileFlags = (registration.featureFlags ?? []) as IRegisteredFlag[];
        expect(mobileFlags.length).toBeGreaterThan(0);
        for (const flag of mobileFlags) {
            expect(
                manifestFlagKeys.has(flag.key),
                `mobile feature flag "${flag.key}" is not declared in plugin.json`,
            ).toBe(true);
        }
    });

    it('matches the certified registration snapshot', () => {
        const normalized = {
            id: registration.id,
            version: registration.version,
            pluginApiVersion: registration.pluginApiVersion,
            styles: styles
                .map((s) => ({
                    name: s.name,
                    category: s.category,
                    frontendOnly: s.frontendOnly ?? false,
                    canHaveChildren: s.canHaveChildren ?? false,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            featureFlags: ((registration.featureFlags ?? []) as IRegisteredFlag[])
                .map((f) => ({ key: f.key, defaultEnabled: f.defaultEnabled ?? false }))
                .sort((a, b) => a.key.localeCompare(b.key)),
        };

        expect(normalized).toMatchInlineSnapshot(`
          {
            "featureFlags": [
              {
                "defaultEnabled": false,
                "key": "gpx",
              },
              {
                "defaultEnabled": true,
                "key": "rich-text",
              },
              {
                "defaultEnabled": false,
                "key": "video",
              },
            ],
            "id": "sh2-shp-survey-js",
            "pluginApiVersion": "0.1.0",
            "styles": [
              {
                "canHaveChildren": false,
                "category": "forms",
                "frontendOnly": true,
                "name": "surveyjs",
              },
            ],
            "version": "0.2.1",
          }
        `);
    });
});

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Guards the contract of `src/theme/mantine-adapter.css`: it only
 * points SurveyJS tokens at Mantine variables. A SurveyJS or Mantine
 * update that renames a variable fails here instead of silently
 * dropping part of the look.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const adapterCss = readFileSync(resolve(__dirname, '../src/theme/mantine-adapter.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const surveyCss = readFileSync(require.resolve('survey-core/survey-core.css'), 'utf8');
const mantineCss = readFileSync(require.resolve('@mantine/core/styles.css'), 'utf8');

function unique(matches: RegExpMatchArray | null): string[] {
    return [...new Set(matches ?? [])];
}

describe('Mantine adapter stylesheet', () => {
    it('sets only design tokens that SurveyJS defines', () => {
        const assigned = unique(adapterCss.match(/--sjs2-[a-z0-9-]+(?=\s*:)/g));
        expect(assigned.length).toBeGreaterThan(100);
        const unknown = assigned.filter((token) => !surveyCss.includes(`${token}:`));
        expect(unknown).toEqual([]);
    });

    it('refers only to variables that Mantine defines', () => {
        const referenced = unique(adapterCss.match(/--mantine-[a-z0-9-]+/g));
        expect(referenced.length).toBeGreaterThan(30);
        const unknown = referenced.filter((variable) => !mantineCss.includes(`${variable}:`));
        expect(unknown).toEqual([]);
    });

    it('copies no colour value, so the site theme and dark mode restyle the survey', () => {
        const hardCoded = unique(adapterCss.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lch)\(\s*[\d.]/gi));
        expect(hardCoded).toEqual([]);
    });

    it('scopes every rule to the SurveyJS theme root', () => {
        const selectors = unique(adapterCss.match(/[^{}]+(?=\{)/g)).map((selector) => selector.trim());
        const unscoped = selectors.filter((selector) => !selector.includes('.sjs-theme-overrides'));
        expect(unscoped).toEqual([]);
    });
});

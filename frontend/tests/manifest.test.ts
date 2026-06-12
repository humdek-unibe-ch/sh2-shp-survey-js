/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Reference-plugin release-contract test (plan MEDIUM 9 / CRITICAL 5).
 *
 * Asserts the SurveyJS `plugin.json` is internally consistent and that its
 * SelfHelp compatibility range resolves against the CURRENT core version scheme
 * (pre-release 0.1.x), not the legacy 8.x/1.x schemes. This is the
 * official-plugin guardrail: if a core/version-scheme change ever breaks
 * resolution, this test fails before a broken manifest is published to the
 * unified registry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
    readFileSync(path.resolve(here, '..', '..', 'plugin.json'), 'utf8'),
) as {
    id: string;
    version: string;
    pluginApiVersion: string;
    compatibility: { selfhelp: string };
    backend: { composer: { version: string } };
    mobile: { version: string };
    security: { trustLevel: string; signing: { required: boolean } };
    dataAccess: { ownedTables: string[]; ownedDataTablePrefix: string };
};

/** The core version the current SelfHelp pre-release ships (CRITICAL 5). */
const CURRENT_CORE = '0.1.0';

interface Semver { major: number; minor: number; patch: number; pre?: string }

function parse(v: string): Semver {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
    if (!m) throw new Error(`not semver: ${v}`);
    return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] };
}

function cmp(a: Semver, b: Semver): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.pre && b.pre) return a.pre.localeCompare(b.pre);
    if (a.pre) return -1; // a prerelease < its release
    if (b.pre) return 1;
    return 0;
}

/** Minimal `>=a <b` (space-joined) range satisfier — enough for plugin ranges. */
function satisfies(version: string, range: string): boolean {
    const v = parse(version);
    return range
        .trim()
        .split(/\s+/)
        .every((part) => {
            if (part.startsWith('>=')) return cmp(v, parse(part.slice(2))) >= 0;
            if (part.startsWith('<=')) return cmp(v, parse(part.slice(2))) <= 0;
            if (part.startsWith('>')) return cmp(v, parse(part.slice(1))) > 0;
            if (part.startsWith('<')) return cmp(v, parse(part.slice(1))) < 0;
            if (part.startsWith('=')) return cmp(v, parse(part.slice(1))) === 0;
            return cmp(v, parse(part)) === 0;
        });
}

describe('SurveyJS plugin.json release contract', () => {
    it('is the official, signed-policy reference plugin', () => {
        expect(manifest.id).toBe('sh2-shp-survey-js');
        expect(manifest.security.trustLevel).toBe('official');
        expect(typeof manifest.security.signing.required).toBe('boolean');
    });

    it('keeps version consistent across backend composer + mobile package', () => {
        expect(manifest.backend.composer.version).toBe(manifest.version);
        expect(manifest.mobile.version).toBe(manifest.version);
    });

    it('resolves against the current 0.1.x core version scheme (not legacy 8.x/1.x)', () => {
        expect(satisfies(CURRENT_CORE, manifest.compatibility.selfhelp)).toBe(true);
        // A later 0.1.x core patch still resolves within the same pre-1.0 minor.
        expect(satisfies('0.1.9', manifest.compatibility.selfhelp)).toBe(true);
    });

    it('declares an OPEN-ENDED core range (ecosystem compatibility policy)', () => {
        // Policy: the core axis is an open-ended minimum (">=0.1.0"); breaking
        // plugin-facing changes are signalled via pluginApiVersion, and
        // retroactive breakage via the registry blocked flag / advisories. A
        // closed upper bound would wrongly block every future core minor.
        expect(manifest.compatibility.selfhelp.trim()).toBe('>=0.1.0');
        expect(satisfies('0.2.0', manifest.compatibility.selfhelp)).toBe(true);
        expect(satisfies('1.0.0', manifest.compatibility.selfhelp)).toBe(true);
        // Below the declared floor still fails.
        expect(satisfies('0.0.9', manifest.compatibility.selfhelp)).toBe(false);
    });

    it('declares owned tables under its reserved data-table prefix', () => {
        expect(manifest.dataAccess.ownedTables.length).toBeGreaterThan(0);
        expect(manifest.dataAccess.ownedDataTablePrefix).toMatch(/^sh2_surveyjs_/);
    });
});

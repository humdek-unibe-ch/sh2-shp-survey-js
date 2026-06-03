/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Vitest config for the mobile package (plan Slice 8D).
 *
 * Slice 8D ships the first mobile test: the renderer-parity + registration
 * snapshot for the SurveyJS read-only viewer. It only inspects the object
 * returned by `registerMobile()`, so we run in the lightweight `node`
 * environment and alias `react-native` to an inert stub
 * (`__tests__/support/react-native-stub.ts`) — the real native runtime
 * cannot load under Node.
 *
 * Slice 9 expands this with the renderer helper unit tests + a
 * `test:renderer` script + the dedicated `plugin-mobile-check.yml`.
 *
 * Install with `npm install` (vitest is a devDependency) before running.
 */

// @ts-expect-error -- Vitest is an optional devDependency resolved at runtime once `npm install` has run.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
        globals: false,
    },
    resolve: {
        alias: {
            'react-native': fileURLToPath(
                new URL('./__tests__/support/react-native-stub.ts', import.meta.url),
            ),
        },
    },
});

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Vitest config for the frontend.
 *
 * Tests live under `tests/` to keep them out of the build entrypoint.
 * The jsdom environment is required by the runtime helpers that touch
 * `window.localStorage` / `window.location` (LocalDraftStore,
 * urlParams) and by the React component tests.
 *
 * Install with `npm install --save-dev vitest jsdom` before running.
 */

// @ts-expect-error -- Vitest is an optional devDependency. The
// reference resolves at runtime when `npm install` has been run.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        globals: false,
    },
});

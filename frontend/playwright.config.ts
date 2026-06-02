/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Playwright config for the SurveyJS plugin E2E suite (plan Slice 8D;
 * golden workflow §19.5 "Survey lifecycle").
 *
 * Specs live under `tests/e2e/` and drive the SurveyJS Creator admin page
 * inside a *running host frontend* (with this plugin built + mounted).
 * Because that is a heavy, full-stack scenario, the suite is release-tier
 * (`plugin-certification.yml`) and self-skips when the QA env is absent —
 * so `npm run test:e2e` is safe on a machine without a stack.
 *
 * Vitest owns the unit tests (the `.test.ts` / `.test.tsx` files under
 * `tests/`). Playwright owns the `.spec.ts` files under `tests/e2e/`. The
 * two runners never collide: different directories + different suffixes.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI
        ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'playwright-report/results.xml' }]]
        : [['list']],
    use: {
        baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

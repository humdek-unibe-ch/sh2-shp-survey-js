/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Golden workflow (web): the SurveyJS Creator admin page loads and is
 * editable for an admin who holds `surveyjs.surveys.manage`
 * (plan Slice 8D; golden workflow §19.5 "Survey lifecycle").
 *
 * Exercises the real host frontend with this plugin mounted:
 *   1. A QA admin logs in (perf budget: login).
 *   2. They open the plugin's consolidated admin page (perf budget: list).
 *   3. The public effect — the "SurveyJS" admin surface with a Designer
 *      tab — is asserted (canonical Testing Rule 17: assert the
 *      domain-visible effect, not a status code).
 *   4. When a QA survey id is supplied, the spec opens the Designer and
 *      asserts the SurveyJS Creator root (`.svc-creator`) actually mounts
 *      (perf budget: creator load) — proving the Creator renders, not just
 *      that the route resolves.
 *
 * Requires a prepared QA stack + QA admin env (see tests/e2e/utils/env.ts).
 * Skips cleanly when that env is absent so it never fails on a machine
 * without a running stack.
 */
import { test, expect } from '@playwright/test';
import { creatorEnv, isCreatorE2eConfigured } from './utils/env';
import { loginAs } from './utils/loginAs';
import { measure, PERF_BUDGETS } from './utils/perf';

test.describe('golden: the SurveyJS Creator admin page loads for a manage-capable admin', () => {
    test.skip(
        !isCreatorE2eConfigured(),
        'Set QA_ADMIN_EMAIL + QA_ADMIN_PASSWORD (and run a QA stack with the plugin mounted) to execute the Creator E2E.',
    );

    test('admin opens the SurveyJS admin page and reaches the Designer', async ({ page }) => {
        const env = creatorEnv();

        await measure('login', PERF_BUDGETS.loginMs, () =>
            loginAs(page, env.email, env.password, env.loginKeyword),
        );

        await measure('surveyjsAdminList', PERF_BUDGETS.adminPagesListMs, async () => {
            await page.goto(env.adminPath);
            // Public effect: the plugin's admin surface renders its Designer tab.
            await expect(page.getByRole('tab', { name: /designer/i })).toBeVisible();
        });

        if (env.surveyId) {
            // Open the Creator on a known QA survey and assert the SurveyJS
            // Creator root actually mounts — the meaningful "Creator works"
            // signal (`.svc-creator` is survey-creator-react's stable root).
            await measure('creatorLoad', PERF_BUDGETS.creatorLoadMs, async () => {
                await page.goto(`${env.adminPath}?view=designer&id=${encodeURIComponent(env.surveyId as string)}`);
                await expect(page.locator('.svc-creator, .svc-creator__content-wrapper').first()).toBeVisible();
            });
        } else {
            // No seeded survey: still prove the Designer tab is interactive
            // and the app does not error out when switching to it.
            await page.getByRole('tab', { name: /designer/i }).click();
            await expect(page).toHaveURL(/view=designer/);
            await expect(page.getByText(/failed to load|something went wrong/i)).toHaveCount(0);
        }
    });
});

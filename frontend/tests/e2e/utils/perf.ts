/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Performance budgets for the Creator E2E (canonical Testing Rule 29).
 * Mirrors the host frontend's `e2e/utils/perf.ts`: a run slower than 2×
 * the budget BLOCKS; 1.5×–2× warns. The Creator is a heavy editor, so its
 * budget is generous relative to plain admin lists.
 */
import { expect } from '@playwright/test';

export const PERF_BUDGETS = {
    loginMs: 500,
    adminPagesListMs: 1000,
    creatorLoadMs: 4000,
} as const;

export async function measure<T>(label: string, budgetMs: number, action: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await action();
    const elapsed = Date.now() - start;

    const hardLimit = budgetMs * 2;
    const warnLimit = budgetMs * 1.5;

    // eslint-disable-next-line no-console
    console.log(`[perf] ${label}: ${elapsed}ms (budget ${budgetMs}ms, block > ${hardLimit}ms)`);
    if (elapsed > warnLimit && elapsed <= hardLimit) {
        // eslint-disable-next-line no-console
        console.warn(`[perf][WARN] ${label} ${elapsed}ms exceeds 1.5× budget (${warnLimit}ms)`);
    }

    expect(elapsed, `${label} exceeded 2× perf budget (${hardLimit}ms)`).toBeLessThanOrEqual(hardLimit);
    return result;
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { describe, expect, it, vi } from 'vitest';
import { CountdownTimer } from '../src/runtime/countdownTimer';

describe('CountdownTimer', () => {
    it('fires the callback after the requested wall-clock interval', () => {
        vi.useFakeTimers();
        try {
            let called = 0;
            const timer = new CountdownTimer({
                durationMs: 1_000,
                tickMs: 100,
                onExpire: () => { called++; },
            });
            timer.start();
            vi.advanceTimersByTime(900);
            expect(called).toBe(0);
            vi.advanceTimersByTime(300);
            expect(called).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancel stops a pending elapsed callback', () => {
        vi.useFakeTimers();
        try {
            let called = 0;
            const timer = new CountdownTimer({
                durationMs: 1_000,
                tickMs: 100,
                onExpire: () => { called++; },
            });
            timer.start();
            timer.cancel();
            vi.advanceTimersByTime(2_000);
            expect(called).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports remainingMs counting down from the requested duration', () => {
        vi.useFakeTimers();
        try {
            const timer = new CountdownTimer({
                durationMs: 1_000,
                tickMs: 100,
                onExpire: () => undefined,
            });
            timer.start();
            expect(timer.remainingMs()).toBeGreaterThan(900);
            vi.advanceTimersByTime(300);
            expect(timer.remainingMs()).toBeLessThanOrEqual(700);
            timer.cancel();
        } finally {
            vi.useRealTimers();
        }
    });
});

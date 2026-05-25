/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Lightweight wall-clock timeout helper for surveys.
 *
 * Backed by `setTimeout` (not `setInterval`) so the runtime survives
 * a paused tab — we re-check the elapsed time every "tick" and fire
 * `onExpire` as soon as the wall-clock budget runs out. This matches
 * the legacy plugin's `checkTimeout()` semantics where the survey
 * locks out even if the participant left the tab idle.
 */

export interface ITimerHandle {
    start(): void;
    cancel(): void;
    remainingMs(): number;
}

interface ITimerOptions {
    durationMs: number;
    onExpire: () => void;
    tickMs?: number;
}

export class CountdownTimer implements ITimerHandle {
    private endsAt: number | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly options: ITimerOptions) {}

    start(): void {
        this.endsAt = Date.now() + this.options.durationMs;
        this.scheduleTick();
    }

    cancel(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.endsAt = null;
    }

    remainingMs(): number {
        if (this.endsAt === null) return 0;
        return Math.max(0, this.endsAt - Date.now());
    }

    private scheduleTick(): void {
        const tick = this.options.tickMs ?? 1000;
        this.timer = setTimeout(() => {
            this.timer = null;
            const remaining = this.remainingMs();
            if (remaining <= 0) {
                this.cancel();
                this.options.onExpire();
                return;
            }
            this.scheduleTick();
        }, tick);
    }
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Pure, DOM-free SurveyJS lifecycle helpers shared by the WebView runtime
 * controller and the host shell. These mirror the frontend runtime
 * (`frontend/src/runtime/SurveyRuntime.tsx`) so mobile enforces the SAME
 * once-per-user / schedule / redirect semantics as the web — the behaviour
 * parity the plan requires.
 *
 * Nothing here touches `document`/`window` or `survey-react-ui`, so the unit
 * tests run headless in Node against the real `survey-core` model.
 */

import type { IRuntimeSectionConfig } from '../styles/section';
import type { ISubmissionEnforcePayload } from '../api/surveys';

/** Build the `enforce` payload the backend re-validates the submission against. */
export function buildEnforcePayload(
    config: IRuntimeSectionConfig,
    responseId: string | null,
    pageNo: number,
): ISubmissionEnforcePayload {
    const scheduleWindow = config.oncePerSchedule
        ? resolveScheduleWindow(config.startTime, config.endTime)
        : null;
    return {
        oncePerUser: config.oncePerUser,
        oncePerSchedule: config.oncePerSchedule,
        allowAnonymous: config.allowAnonymous,
        windowStart: scheduleWindow?.start ?? null,
        windowEnd: scheduleWindow?.end ?? null,
        responseId: responseId ?? undefined,
        editMode: false,
        progress: { pageNo, triggerType: 'finished' },
    };
}

/** True when the current local time falls outside a configured daily window. */
export function isOutsideSchedule(config: { startTime: string | null; endTime: string | null }): boolean {
    if (!config.startTime || !config.endTime) return false;
    if (config.startTime === '00:00' && config.endTime === '00:00') return false;
    const start = parseClockTime(config.startTime);
    const end = parseClockTime(config.endTime);
    if (start === null || end === null) return false;
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (start <= end) {
        return minutesNow < start || minutesNow > end;
    }
    return minutesNow > end && minutesNow < start;
}

export function resolveScheduleWindow(
    startTime: string | null,
    endTime: string | null,
): { start: string; end: string } | null {
    const start = parseClockTimeParts(startTime);
    const end = parseClockTimeParts(endTime);
    if (!start || !end) return null;
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(start.hour, start.minute, 0, 0);
    const windowEnd = new Date(now);
    windowEnd.setHours(end.hour, end.minute, 0, 0);
    if (windowStart.getTime() > windowEnd.getTime()) {
        if (windowEnd.getTime() > now.getTime()) {
            windowStart.setDate(windowStart.getDate() - 1);
        } else {
            windowEnd.setDate(windowEnd.getDate() + 1);
        }
    }
    return { start: windowStart.toISOString(), end: windowEnd.toISOString() };
}

function parseClockTime(time: string | null): number | null {
    const parts = parseClockTimeParts(time);
    return parts ? parts.hour * 60 + parts.minute : null;
}

function parseClockTimeParts(time: string | null): { hour: number; minute: number } | null {
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
    const parts = time.split(':').map((part) => Number.parseInt(part, 10));
    return { hour: parts[0] ?? 0, minute: parts[1] ?? 0 };
}

/** Generate a `R_...` response id; uses Web Crypto when available. */
export function cryptoRandomHex(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    const webCrypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => void } }).crypto;
    if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
        webCrypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < byteLength; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function newResponseId(): string {
    return `R_${cryptoRandomHex(8)}`;
}

/**
 * CMS status labels can arrive as editor HTML (`<p>…</p>`); the WebView shell
 * surfaces plain text, so strip tags down to readable content.
 */
export function stripHtml(label: string | null): string | null {
    const value = label?.trim() ?? '';
    if (value === '') return null;
    const text = value
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>(?!$)/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    return text === '' ? null : text;
}

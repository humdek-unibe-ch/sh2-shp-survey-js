/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Snapshot of the runtime environment captured at survey start.
 *
 * The legacy plugin's `4_surveyJS.js` shipped a similar `_meta` blob
 * inside every submission so the dashboard could show the participant
 * locale, screen geometry, and user-agent without joining auxiliary
 * tables. We keep the same shape (renamed to camelCase) so an export
 * pipeline that consumed the legacy field can be migrated 1:1.
 */

export interface ISurveyMeta {
    startedAt: string;
    locale: string;
    userAgent: string;
    timeZone: string | null;
    screen: { width: number; height: number; dpr: number } | null;
    viewport: { width: number; height: number } | null;
    language: string;
}

export function captureSurveyMeta(): ISurveyMeta {
    const now = new Date();
    const isServer = typeof window === 'undefined';
    return {
        startedAt: now.toISOString(),
        locale: !isServer && typeof navigator !== 'undefined' ? navigator.language : 'en',
        userAgent: !isServer && typeof navigator !== 'undefined' ? navigator.userAgent : '',
        timeZone: !isServer ? safeTimeZone() : null,
        screen: !isServer && typeof window !== 'undefined' && window.screen
            ? {
                width: window.screen.width,
                height: window.screen.height,
                dpr: window.devicePixelRatio ?? 1,
            }
            : null,
        viewport: !isServer && typeof window !== 'undefined'
            ? { width: window.innerWidth, height: window.innerHeight }
            : null,
        language: !isServer && typeof navigator !== 'undefined' ? navigator.language : 'en',
    };
}

function safeTimeZone(): string | null {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
        return null;
    }
}

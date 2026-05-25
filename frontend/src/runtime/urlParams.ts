/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Capture URL query-string parameters so the runtime can forward them
 * to SurveyJS as `extra_param_<key>` variables (matching the legacy
 * plugin's `getURLParams()` helper in `4_surveyJS.js`).
 *
 * Keys clash-free with SurveyJS reserved variables (`resultId`,
 * `responseId`, `record_id`) are dropped so a participant cannot
 * tamper with internal flow via the URL.
 */

const RESERVED_KEYS = new Set([
    'resultId',
    'responseId',
    'record_id',
    'record-id',
]);

export function extractUrlParams(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const out: Record<string, string> = {};
    const search = new URL(window.location.href).searchParams;
    search.forEach((value, key) => {
        if (RESERVED_KEYS.has(key)) return;
        out[key] = value;
    });
    return out;
}

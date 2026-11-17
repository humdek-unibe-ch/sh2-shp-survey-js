/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The guest key: a random 128-bit id this browser keeps, sent with every
 * public survey call so the backend can find a guest's response again (a
 * guest's response has no owner). It is not an auth token: it only ties a
 * guest to the answers this browser already holds in its local draft.
 *
 * Sent as a header because the host BFF drops every cookie the backend sets.
 * Without storage (private mode, blocked site data) the key lives for the
 * page only: the guest can still answer and submit, but not resume later.
 */

const STORAGE_KEY = 'sh2-surveyjs:guest-key';
export const GUEST_KEY_HEADER = 'X-SurveyJs-Guest-Key';

let pageKey: string | null = null;

function randomKey(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function guestKey(): string {
    if (pageKey !== null) return pageKey;
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && /^[a-f0-9]{32}$/i.test(stored)) {
            pageKey = stored;
            return stored;
        }
        pageKey = randomKey();
        window.localStorage.setItem(STORAGE_KEY, pageKey);
    } catch {
        pageKey ??= randomKey();
    }
    return pageKey;
}

export function guestKeyHeaders(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    return { [GUEST_KEY_HEADER]: guestKey() };
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `localStorage`-backed draft cache.
 *
 * The runtime persists per-page autosaves both to the server (cross
 * device) AND to `localStorage` (fast resume on the same device,
 * resilient against transient network failures). This module is the
 * client-only side of that pair.
 *
 * Keying is `<storageNamespace>:<responseId>`. We keep the most
 * recently saved entry per namespace plus an index pointer
 * (`<storageNamespace>:__latest`) for the "no `?responseId=`"
 * resume-on-refresh path.
 */

import type { ISurveyMeta } from './surveyMeta';

export interface ILocalDraftEntry {
    responseId: string;
    pageNo: number;
    data: Record<string, unknown>;
    meta?: ISurveyMeta | null;
    savedAt: string;
}

const LATEST_SUFFIX = ':__latest';

export class LocalDraftStore {
    constructor(private readonly namespace: string) {}

    save(entry: Omit<ILocalDraftEntry, 'savedAt'>): void {
        if (!this.isAvailable()) return;
        const stored: ILocalDraftEntry = {
            ...entry,
            savedAt: new Date().toISOString(),
        };
        try {
            window.localStorage.setItem(this.key(entry.responseId), JSON.stringify(stored));
            window.localStorage.setItem(this.namespace + LATEST_SUFFIX, entry.responseId);
        } catch {
            // Quota exceeded / private mode: silently fall back to
            // server autosave only.
        }
    }

    loadLatest(): ILocalDraftEntry | null {
        if (!this.isAvailable()) return null;
        const latest = window.localStorage.getItem(this.namespace + LATEST_SUFFIX);
        if (!latest) return null;
        return this.load(latest);
    }

    load(responseId: string): ILocalDraftEntry | null {
        if (!this.isAvailable()) return null;
        const raw = window.localStorage.getItem(this.key(responseId));
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && typeof parsed.responseId === 'string') {
                return parsed as ILocalDraftEntry;
            }
        } catch {
            // Drop the unparsable entry below.
        }
        try {
            window.localStorage.removeItem(this.key(responseId));
        } catch {
            // ignore
        }
        return null;
    }

    clear(responseId: string): void {
        if (!this.isAvailable()) return;
        try {
            window.localStorage.removeItem(this.key(responseId));
            const latest = window.localStorage.getItem(this.namespace + LATEST_SUFFIX);
            if (latest === responseId) {
                window.localStorage.removeItem(this.namespace + LATEST_SUFFIX);
            }
        } catch {
            // ignore
        }
    }

    clearAll(): void {
        if (!this.isAvailable()) return;
        try {
            const prefix = `${this.namespace}:`;
            const keysToRemove: string[] = [];
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.push(this.namespace + LATEST_SUFFIX);
            for (const key of keysToRemove) {
                window.localStorage.removeItem(key);
            }
        } catch {
            // ignore
        }
    }

    private key(responseId: string): string {
        return `${this.namespace}:${responseId}`;
    }

    private isAvailable(): boolean {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    }
}

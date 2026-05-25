/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDraftStore } from '../src/runtime/localDraftStore';

describe('LocalDraftStore', () => {
    let store: LocalDraftStore;

    beforeEach(() => {
        window.localStorage.clear();
        store = new LocalDraftStore('sh2-test');
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('saves and reloads the most recent draft', () => {
        store.save({ responseId: 'r1', data: { a: 1 }, pageNo: 0 });
        const loaded = store.loadLatest();
        expect(loaded?.responseId).toBe('r1');
        expect(loaded?.data).toEqual({ a: 1 });
    });

    it('keeps drafts keyed by responseId for direct lookup', () => {
        store.save({ responseId: 'r1', data: { a: 1 }, pageNo: 0 });
        store.save({ responseId: 'r2', data: { b: 2 }, pageNo: 1 });
        expect(store.load('r1')?.data).toEqual({ a: 1 });
        expect(store.load('r2')?.data).toEqual({ b: 2 });
    });

    it('clear removes only the targeted draft', () => {
        store.save({ responseId: 'r1', data: { a: 1 }, pageNo: 0 });
        store.save({ responseId: 'r2', data: { b: 2 }, pageNo: 1 });
        store.clear('r1');
        expect(store.load('r1')).toBeNull();
        expect(store.load('r2')?.data).toEqual({ b: 2 });
    });
});

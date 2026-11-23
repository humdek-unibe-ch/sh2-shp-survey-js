/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publishVersion, saveDraft, SurveyApiError } from '../src/api/surveys-admin';

function reply(status: number, body: unknown): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

describe('admin API refusals', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('tells a draft saved by someone else apart, so the editor offers load or overwrite', async () => {
        reply(409, { error: 'Draft has changed since it was loaded.', data: { reason: 'draft_conflict' } });

        const error = await saveDraft(3, { definition: { pages: [] } }).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(SurveyApiError);
        expect(error).toMatchObject({ status: 409, reason: 'draft_conflict', message: 'Draft has changed since it was loaded.' });
    });

    it('reports a refused publish of a renamed answered question with its own reason, not as a conflict', async () => {
        reply(409, { error: 'Cannot publish: question name(s) "mood" already have stored responses…', data: { reason: 'answered_question_renamed' } });

        const error = await publishVersion(3, { definition: { pages: [] } }).catch((err: unknown) => err);

        expect(error).toMatchObject({ status: 409, reason: 'answered_question_renamed' });
    });

    it('has no reason when the server gives none', async () => {
        reply(500, { error: 'Something broke.' });

        const error = await saveDraft(3, { definition: { pages: [] } }).catch((err: unknown) => err);

        expect(error).toMatchObject({ status: 500, reason: null, message: 'Something broke.' });
    });
});

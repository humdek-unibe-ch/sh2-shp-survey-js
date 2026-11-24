/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { describe, expect, it } from 'vitest';

import { surveyRowLinks } from '../src/admin/SurveyListPage';

const rights = (update: boolean) => ({ update, publish: false, delete: false });

describe('survey list row', () => {
    it('offers the answers to a reader who may see them', () => {
        expect(surveyRowLinks({ responseCount: 3, rights: rights(false) })).toEqual({ openView: 'answers', readsAnswers: true });
    });

    it('hides the Answers eye from a reader without access and opens the versions instead', () => {
        expect(surveyRowLinks({ responseCount: null, rights: rights(false) })).toEqual({ openView: 'versions', readsAnswers: false });
    });

    it('opens the designer for an editor, with or without access to the answers', () => {
        expect(surveyRowLinks({ responseCount: null, rights: rights(true) })).toEqual({ openView: 'design', readsAnswers: false });
        expect(surveyRowLinks({ responseCount: 0, rights: rights(true) })).toEqual({ openView: 'design', readsAnswers: true });
    });
});

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { describe, expect, it } from 'vitest';

import type { IAdminSurveySummary } from '../src/api/surveys-admin';
import { filterSurveys } from '../src/admin/surveyListFilter';

function survey(id: number, name: string, archived: boolean, updatedAt: string): IAdminSurveySummary {
    return {
        id,
        surveyId: `SV_${id}ABC`,
        name,
        themeCode: null,
        archived,
        updatedAt,
        currentRevision: null,
        draftHash: null,
        draftUpdatedAt: null,
        draftUpdatedByUserId: null,
        responseCount: null,
        dataTableId: null,
        rights: { update: false, publish: false, delete: false },
    };
}

// In the order the server sends them: last changed first.
const surveys = [
    survey(2, 'Mood check', true, '2026-11-03T10:00:00+00:00'),
    survey(3, 'Sleep follow-up', false, '2026-11-02T10:00:00+00:00'),
    survey(1, 'Sleep diary', false, '2026-11-01T10:00:00+00:00'),
];

describe('survey list filter', () => {
    it('shows the active surveys by default, keeping the server order', () => {
        expect(filterSurveys(surveys, '', 'active').map((s) => s.id)).toEqual([3, 1]);
    });

    it('shows archived surveys only when asked for', () => {
        expect(filterSurveys(surveys, '', 'archived').map((s) => s.id)).toEqual([2]);
        expect(filterSurveys(surveys, '', 'all').map((s) => s.id)).toEqual([2, 3, 1]);
    });

    it('finds a survey by part of its name or its survey id, ignoring case', () => {
        expect(filterSurveys(surveys, ' SLEEP ', 'all').map((s) => s.id)).toEqual([3, 1]);
        expect(filterSurveys(surveys, 'sv_2', 'all').map((s) => s.id)).toEqual([2]);
    });
});

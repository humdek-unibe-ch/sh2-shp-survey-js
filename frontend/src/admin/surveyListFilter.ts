/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import type { IAdminSurveySummary } from '../api/surveys-admin';

export type TStateFilter = 'active' | 'archived' | 'all';

/** The surveys matching the search (name or survey ID) and state, in the server's order (last changed first). */
export function filterSurveys(surveys: IAdminSurveySummary[], search: string, state: TStateFilter): IAdminSurveySummary[] {
    const needle = search.trim().toLowerCase();

    return surveys
        .filter((survey) => state === 'all' || survey.archived === (state === 'archived'))
        .filter((survey) => needle === '' || survey.name.toLowerCase().includes(needle) || survey.surveyId.toLowerCase().includes(needle));
}

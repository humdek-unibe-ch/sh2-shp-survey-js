/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Where the survey admin is, kept in the query string because the host
 * gives a plugin page a single path segment: no `id` is the survey list,
 * `id` plus `view` is one survey's tab. Links from before wave 8 (`designer`,
 * `dashboard`, `responses`) still land on the matching tab.
 */

export type TSurveyView = 'design' | 'answers' | 'versions' | 'settings';

export interface IAdminLocation {
    surveyId: number | null;
    view: TSurveyView;
}

const VIEWS: readonly TSurveyView[] = ['design', 'answers', 'versions', 'settings'];

const OLD_VIEWS: Readonly<Record<string, TSurveyView>> = {
    designer: 'design',
    dashboard: 'answers',
    responses: 'answers',
};

export function parseAdminLocation(search: string): IAdminLocation {
    const params = new URLSearchParams(search);
    const rawId = params.get('id');
    const surveyId = rawId !== null && /^\d+$/.test(rawId) ? Number(rawId) : null;
    const rawView = params.get('view') ?? '';
    const view = (VIEWS as readonly string[]).includes(rawView) ? (rawView as TSurveyView) : OLD_VIEWS[rawView] ?? 'design';

    return { surveyId, view };
}

/** The query string for a location, keeping any other parameter already in `search`. */
export function formatAdminLocation(location: IAdminLocation, search = ''): string {
    const params = new URLSearchParams(search);
    params.delete('id');
    params.delete('view');
    if (location.surveyId !== null) {
        params.set('id', String(location.surveyId));
        params.set('view', location.view);
    }
    const query = params.toString();

    return query === '' ? '' : `?${query}`;
}

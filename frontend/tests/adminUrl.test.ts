/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { describe, expect, it } from 'vitest';

import { formatAdminLocation, parseAdminLocation } from '../src/admin/adminUrl';

describe('survey admin location', () => {
    it('opens the survey list without a survey id', () => {
        expect(parseAdminLocation('')).toEqual({ surveyId: null, view: 'design' });
        expect(parseAdminLocation('?id=abc&view=answers')).toEqual({ surveyId: null, view: 'answers' });
    });

    it('opens a survey on the tab the link names, the editor by default', () => {
        expect(parseAdminLocation('?id=12&view=versions')).toEqual({ surveyId: 12, view: 'versions' });
        expect(parseAdminLocation('?id=12')).toEqual({ surveyId: 12, view: 'design' });
        expect(parseAdminLocation('?id=12&view=nonsense')).toEqual({ surveyId: 12, view: 'design' });
    });

    it('sends links from before the redesign to the matching tab', () => {
        expect(parseAdminLocation('?id=3&view=designer').view).toBe('design');
        expect(parseAdminLocation('?id=3&view=dashboard').view).toBe('answers');
        expect(parseAdminLocation('?id=3&view=responses').view).toBe('answers');
    });

    it('writes the list as a bare URL and keeps parameters it does not own', () => {
        expect(formatAdminLocation({ surveyId: null, view: 'answers' }, '?id=4&view=answers')).toBe('');
        expect(formatAdminLocation({ surveyId: 4, view: 'settings' }, '?lang=de')).toBe('?lang=de&id=4&view=settings');
        expect(parseAdminLocation(formatAdminLocation({ surveyId: 9, view: 'answers' }))).toEqual({ surveyId: 9, view: 'answers' });
    });
});

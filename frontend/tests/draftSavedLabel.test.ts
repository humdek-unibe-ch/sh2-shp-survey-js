/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
import { describe, expect, it } from 'vitest';

import { draftSavedLabel } from '../src/admin/SurveyDesignerPage';

const now = new Date(2026, 10, 25, 15, 0);

describe('draft saved label in the designer bar', () => {
    it('shows only the time for a draft saved today', () => {
        const savedAt = new Date(2026, 10, 25, 9, 41);
        expect(draftSavedLabel(savedAt.toISOString(), now)).toBe(
            `Saved ${savedAt.toLocaleTimeString(undefined, { timeStyle: 'short' })}`,
        );
    });

    it('shows the date for a draft saved on an earlier day', () => {
        const savedAt = new Date(2026, 10, 24, 16, 51);
        expect(draftSavedLabel(savedAt.toISOString(), now)).toBe(
            `Saved ${savedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
        );
    });
});

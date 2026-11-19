/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { describe, expect, it } from 'vitest';
import { stateMessageHtml } from '../src/runtime/stateMessage';

describe('stateMessageHtml', () => {
    it('shows nothing when the section leaves the text empty', () => {
        for (const empty of [null, '', '   ', '<p class="single-line-paragraph"></p>', '<p>&nbsp;</p>']) {
            expect(stateMessageHtml(empty)).toBeNull();
        }
    });

    it('shows the section text when it has one', () => {
        expect(stateMessageHtml('<p>Come back on **Monday**</p>')).toContain('Come back on');
        expect(stateMessageHtml('Come back on **Monday**')).toContain('<strong>Monday</strong>');
    });
});

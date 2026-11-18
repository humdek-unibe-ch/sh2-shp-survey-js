/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { describe, expect, it } from 'vitest';
import { stateMessageHtml } from '../src/runtime/stateMessage';

const FALLBACK = 'This survey is not open right now.';

describe('stateMessageHtml', () => {
    it('shows the default text when the section leaves the label empty', () => {
        for (const empty of [null, '', '   ', '<p class="single-line-paragraph"></p>', '<p>&nbsp;</p>']) {
            expect(stateMessageHtml(empty, FALLBACK)).toContain(FALLBACK);
        }
    });

    it('shows the section label when it has text', () => {
        const html = stateMessageHtml('<p>Come back on **Monday**</p>', FALLBACK);
        expect(html).toContain('Come back on');
        expect(html).not.toContain(FALLBACK);
        expect(stateMessageHtml('Come back on **Monday**', FALLBACK)).toContain('<strong>Monday</strong>');
    });
});

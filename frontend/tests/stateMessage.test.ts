/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPluginApi } from '@selfhelp/shared/plugin-sdk';
import { setPluginApi } from '../src/runtime/pluginApi';
import { stateMessageHtml } from '../src/runtime/stateMessage';

function hostWith(sanitizeHtml?: (html: string, mode: 'inline' | 'block') => string): void {
    setPluginApi({ pluginId: 'sh2-shp-survey-js', sanitizeHtml } as unknown as IPluginApi);
}

describe('stateMessageHtml', () => {
    afterEach(() => setPluginApi(null as unknown as IPluginApi));

    it('shows nothing when the section leaves the text empty', () => {
        for (const sanitizer of [(html: string) => html, undefined]) {
            hostWith(sanitizer);
            for (const empty of [null, '', '   ', '<p class="single-line-paragraph"></p>', '<p>&nbsp;</p>']) {
                expect(stateMessageHtml(empty)).toBeNull();
            }
        }
    });

    it('shows the section text, sanitized by the host as inline HTML', () => {
        const sanitize = vi.fn((html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ''));
        hostWith(sanitize);

        expect(stateMessageHtml('Come back on **Monday**')).toContain('<strong>Monday</strong>');
        expect(stateMessageHtml('<p>Thanks<script>alert(1)</script></p>')).toBe('<p>Thanks</p>');
        expect(sanitize).toHaveBeenCalledWith('<p>Thanks<script>alert(1)</script></p>', 'inline');
        expect(stateMessageHtml('<p><script>alert(1)</script></p>')).toBeNull();
    });

    it('shows HTML as plain text when the host has no sanitizer', () => {
        hostWith(undefined);

        const html = stateMessageHtml('<p>Thanks<img src="x" onerror="alert(1)"><script>alert(2)</script></p>') ?? '';
        expect(html).toContain('Thanks');
        expect(html).not.toMatch(/<img|onerror|alert/i);
        expect(stateMessageHtml('Come back on **Monday**')).toContain('<strong>Monday</strong>');
    });
});

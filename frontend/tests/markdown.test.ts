/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/runtime/markdown';

describe('renderMarkdown', () => {
    it('escapes raw HTML so script tags cannot run', () => {
        const html = renderMarkdown('<script>alert(1)</script>');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('handles bold / italic / inline code', () => {
        const html = renderMarkdown('Hello **world** and *you* `code`');
        expect(html).toContain('<strong>world</strong>');
        expect(html).toContain('<em>you</em>');
        expect(html).toContain('<code>code</code>');
    });

    it('renders ordered and unordered lists', () => {
        const html = renderMarkdown('- one\n- two\n- three');
        expect(html).toContain('<ul>');
        expect(html).toContain('<li>one</li>');
        expect(html).toContain('<li>three</li>');
    });
});

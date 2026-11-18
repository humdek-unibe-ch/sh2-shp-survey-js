/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { renderMarkdown } from './markdown';

export function stateMessageHtml(label: string | null, fallback: string): string {
    return renderStatusLabel(label) ?? renderMarkdown(fallback);
}

function renderStatusLabel(label: string | null): string | null {
    const value = label?.trim() ?? '';
    if (value === '') {
        return null;
    }

    // CMS translation fields often arrive as already-rendered HTML
    // (`<p>...</p>` from the editor). Preserve that as-is instead of
    // escaping it through the markdown fallback path. Empty editor
    // output like `<p></p>` or `<p>&nbsp;</p>` counts as "not set".
    if (value.startsWith('<') && value.endsWith('>')) {
        return hasMeaningfulHtmlContent(value) ? value : null;
    }

    const rendered = renderMarkdown(value);
    return hasMeaningfulHtmlContent(rendered) ? rendered : null;
}

function hasMeaningfulHtmlContent(value: string): boolean {
    const text = value
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    return text !== '';
}

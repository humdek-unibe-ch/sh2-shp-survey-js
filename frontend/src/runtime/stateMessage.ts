/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import type { IPluginApi } from '@selfhelp/shared/plugin-sdk';
import { renderMarkdown } from './markdown';
import { getPluginApi } from './pluginApi';

/** Mirrors `IPluginApi.sanitizeHtml` of the plugin SDK (`@selfhelp/shared` > 1.24.0). */
type TSanitizingApi = IPluginApi & { sanitizeHtml?: (html: string, mode: 'inline' | 'block') => string };

/**
 * A section text as safe HTML, or null when the section leaves it empty
 * (then nothing is shown). The host sanitizes it with the rules core pages
 * use; a host without the sanitizer gets the text with its markup removed.
 */
export function stateMessageHtml(label: string | null): string | null {
    const value = label?.trim() ?? '';
    if (value === '') {
        return null;
    }

    // CMS translation fields often arrive as already-rendered HTML
    // (`<p>...</p>` from the editor); keep its markup instead of escaping
    // it through the markdown path. Empty editor output like `<p></p>` or
    // `<p>&nbsp;</p>` counts as "not set".
    // Markdown is escaped by `renderMarkdown`, so only authored HTML needs the host.
    const isHtml = value.startsWith('<') && value.endsWith('>');
    const sanitize = (getPluginApi() as TSanitizingApi | null)?.sanitizeHtml;
    let safe: string;
    if (sanitize) {
        safe = sanitize(isHtml ? value : renderMarkdown(value), 'inline');
    } else {
        safe = isHtml ? renderMarkdown(htmlToText(value)) : renderMarkdown(value);
    }
    return hasMeaningfulHtmlContent(safe) ? safe : null;
}

/** HTML as plain text, for a host without a sanitizer: scripts and styles go with their content. */
function htmlToText(value: string): string {
    return value
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
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

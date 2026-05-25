/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Minimal Markdown → HTML pass for runtime status labels
 * (`label_survey_done`, `label_survey_not_active`, timed-out
 * message).
 *
 * Only the subset CMS authors use in labels is supported:
 *   - paragraphs separated by blank lines,
 *   - inline `**bold**`, `*italic*`, `` `code` ``,
 *   - inline links `[text](https://…)` (https/http/mailto/tel/`/`),
 *   - unordered lists (`- item`).
 *
 * Output is HTML-escaped FIRST so user-authored values cannot break
 * out of the surrounding `<p>` / `<li>` wrapper.
 */

const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (ch) => escapeMap[ch] ?? ch);
}

function inline(value: string): string {
    // Escape FIRST so the body of an inline-code span cannot smuggle
    // raw HTML through (e.g. `<script>` inside backticks must still
    // render as text). Backtick is not in escapeMap, so the regex
    // below still matches the same backtick characters the user
    // typed.
    let out = escapeHtml(value);
    // Inline code: `text` → <code>text</code>. Anchored with negative
    // look-arounds so we do not match the opening backtick of a
    // double-backtick `` literal `` form (intentionally unsupported
    // for status labels) and never produce empty `<code></code>`.
    out = out.replace(/(^|[^`])`([^`\r\n]+?)`(?!`)/g, '$1<code>$2</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(
        /\[([^\]]+)\]\(((?:https?:|mailto:|tel:|\/)[^)]+)\)/g,
        '<a href="$2" rel="noopener noreferrer">$1</a>',
    );
    return out;
}

export function renderMarkdown(input: string): string {
    if (!input) return '';
    const blocks = input.replace(/\r\n/g, '\n').split(/\n{2,}/);
    return blocks
        .map((block) => {
            const trimmed = block.trim();
            if (trimmed === '') return '';
            if (/^(- |\* )/.test(trimmed)) {
                const items = trimmed
                    .split(/\n/)
                    .filter((line) => /^(- |\* )/.test(line))
                    .map((line) => `<li>${inline(line.replace(/^(- |\* )/, ''))}</li>`)
                    .join('');
                return `<ul>${items}</ul>`;
            }
            return `<p>${inline(trimmed).replace(/\n/g, '<br>')}</p>`;
        })
        .join('');
}

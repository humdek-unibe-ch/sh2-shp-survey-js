/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey definition diff helpers.
 *
 * Compares two SurveyJS definitions structurally and returns a list
 * of change descriptors plus aggregate counts (`added`, `removed`,
 * `modified`). Used by the Designer header to disable the Publish
 * button when no changes exist, and by the Versions tab to render a
 * compact "what changed" table when the operator compares two
 * revisions.
 *
 * Diff semantics:
 *   - top-level keys other than `pages` and `elements` are compared
 *     value-equality (deep) and reported once if they differ.
 *   - `pages[]` and `elements[]` are matched by their `name` field
 *     when present, falling back to array position. Question (element)
 *     comparisons compare title, type, isRequired, choices, and a
 *     stable JSON hash of the rest of the question.
 *   - Order changes of pages/questions are reported as `moved` so the
 *     operator knows a reorder happened without inflating the change
 *     count to the size of the survey.
 */

export type TDiffKind = 'added' | 'removed' | 'modified' | 'moved' | 'settings';

export interface IDefinitionDiffEntry {
    kind: TDiffKind;
    /** Stable path like `pages[0].elements[1]` or `pages[0]` or `settings.title`. */
    path: string;
    /** Display label, derived from `title` / `name` / `type`. */
    label: string;
    /** Optional secondary descriptor like the question type. */
    detail?: string;
    /** Old/new values for `settings` and `modified` entries. */
    oldValue?: unknown;
    newValue?: unknown;
}

export interface IDefinitionDiffResult {
    entries: IDefinitionDiffEntry[];
    counts: Record<TDiffKind, number>;
    totalChanges: number;
    hasChanges: boolean;
}

interface IQuestionLike {
    name?: string;
    title?: string;
    type?: string;
    isRequired?: boolean;
    choices?: unknown;
    [key: string]: unknown;
}

interface IPageLike {
    name?: string;
    title?: string;
    elements?: IQuestionLike[];
    [key: string]: unknown;
}

interface IDefinitionLike {
    pages?: IPageLike[];
    [key: string]: unknown;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

function questionLabel(question: IQuestionLike, index: number): string {
    if (question.title && typeof question.title === 'string') return question.title;
    if (question.name && typeof question.name === 'string') return question.name;
    return `Question #${index + 1}`;
}

function pageLabel(page: IPageLike, index: number): string {
    if (page.title && typeof page.title === 'string') return page.title;
    if (page.name && typeof page.name === 'string') return page.name;
    return `Page #${index + 1}`;
}

function keyForQuestion(question: IQuestionLike, fallbackIndex: number): string {
    return question.name && typeof question.name === 'string' ? `name:${question.name}` : `idx:${fallbackIndex}`;
}

function keyForPage(page: IPageLike, fallbackIndex: number): string {
    return page.name && typeof page.name === 'string' ? `name:${page.name}` : `idx:${fallbackIndex}`;
}

function questionFingerprint(question: IQuestionLike): string {
    const subset: Record<string, unknown> = {};
    for (const key of Object.keys(question)) {
        if (key === 'name') continue;
        subset[key] = question[key];
    }
    return stableStringify(subset);
}

export function computeDefinitionDiff(
    previous: Record<string, unknown> | null | undefined,
    next: Record<string, unknown> | null | undefined,
): IDefinitionDiffResult {
    const prev = (previous ?? {}) as IDefinitionLike;
    const cur = (next ?? {}) as IDefinitionLike;
    const entries: IDefinitionDiffEntry[] = [];

    const prevPages: IPageLike[] = Array.isArray(prev.pages) ? prev.pages : [];
    const curPages: IPageLike[] = Array.isArray(cur.pages) ? cur.pages : [];

    const prevPageMap = new Map<string, { page: IPageLike; index: number }>();
    prevPages.forEach((page, index) => {
        prevPageMap.set(keyForPage(page, index), { page, index });
    });
    const curPageMap = new Map<string, { page: IPageLike; index: number }>();
    curPages.forEach((page, index) => {
        curPageMap.set(keyForPage(page, index), { page, index });
    });

    for (const [key, { page, index }] of prevPageMap.entries()) {
        if (!curPageMap.has(key)) {
            entries.push({
                kind: 'removed',
                path: `pages[${index}]`,
                label: pageLabel(page, index),
                detail: 'page removed',
            });
        }
    }

    for (const [key, { page: curPage, index: curIndex }] of curPageMap.entries()) {
        const prevEntry = prevPageMap.get(key);
        if (!prevEntry) {
            entries.push({
                kind: 'added',
                path: `pages[${curIndex}]`,
                label: pageLabel(curPage, curIndex),
                detail: 'page added',
            });
            continue;
        }
        if (prevEntry.index !== curIndex) {
            entries.push({
                kind: 'moved',
                path: `pages[${curIndex}]`,
                label: pageLabel(curPage, curIndex),
                detail: `page moved from #${prevEntry.index + 1} to #${curIndex + 1}`,
            });
        }
        diffQuestions(prevEntry.page, curPage, curIndex, entries);
    }

    const ignoreTopLevel = new Set(['pages']);
    const settingsKeys = new Set<string>([
        ...Object.keys(prev).filter((k) => !ignoreTopLevel.has(k)),
        ...Object.keys(cur).filter((k) => !ignoreTopLevel.has(k)),
    ]);
    for (const key of settingsKeys) {
        const prevValue = (prev as Record<string, unknown>)[key];
        const curValue = (cur as Record<string, unknown>)[key];
        if (stableStringify(prevValue) !== stableStringify(curValue)) {
            entries.push({
                kind: 'settings',
                path: `settings.${key}`,
                label: key,
                detail: 'setting changed',
                oldValue: prevValue,
                newValue: curValue,
            });
        }
    }

    const counts: Record<TDiffKind, number> = {
        added: 0,
        removed: 0,
        modified: 0,
        moved: 0,
        settings: 0,
    };
    for (const entry of entries) {
        counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }

    return {
        entries,
        counts,
        totalChanges: entries.length,
        hasChanges: entries.length > 0,
    };
}

function diffQuestions(
    prevPage: IPageLike,
    curPage: IPageLike,
    pageIndex: number,
    entries: IDefinitionDiffEntry[],
): void {
    const prevElements: IQuestionLike[] = Array.isArray(prevPage.elements) ? prevPage.elements : [];
    const curElements: IQuestionLike[] = Array.isArray(curPage.elements) ? curPage.elements : [];

    const prevMap = new Map<string, { question: IQuestionLike; index: number }>();
    prevElements.forEach((q, index) => prevMap.set(keyForQuestion(q, index), { question: q, index }));
    const curMap = new Map<string, { question: IQuestionLike; index: number }>();
    curElements.forEach((q, index) => curMap.set(keyForQuestion(q, index), { question: q, index }));

    for (const [key, { question, index }] of prevMap.entries()) {
        if (!curMap.has(key)) {
            entries.push({
                kind: 'removed',
                path: `pages[${pageIndex}].elements[${index}]`,
                label: questionLabel(question, index),
                detail: typeof question.type === 'string' ? `(${question.type}) removed` : 'question removed',
            });
        }
    }

    for (const [key, { question, index }] of curMap.entries()) {
        const prevEntry = prevMap.get(key);
        if (!prevEntry) {
            entries.push({
                kind: 'added',
                path: `pages[${pageIndex}].elements[${index}]`,
                label: questionLabel(question, index),
                detail: typeof question.type === 'string' ? `(${question.type}) added` : 'question added',
            });
            continue;
        }
        if (prevEntry.index !== index) {
            entries.push({
                kind: 'moved',
                path: `pages[${pageIndex}].elements[${index}]`,
                label: questionLabel(question, index),
                detail: `moved from position ${prevEntry.index + 1} to ${index + 1}`,
            });
        }
        const oldHash = questionFingerprint(prevEntry.question);
        const newHash = questionFingerprint(question);
        if (oldHash !== newHash) {
            entries.push({
                kind: 'modified',
                path: `pages[${pageIndex}].elements[${index}]`,
                label: questionLabel(question, index),
                detail: typeof question.type === 'string' ? `(${question.type}) modified` : 'question modified',
            });
        }
    }
}

export function formatChangeSummary(diff: IDefinitionDiffResult): string {
    if (!diff.hasChanges) return 'No changes since last publish';
    const parts: string[] = [];
    if (diff.counts.added) parts.push(`${diff.counts.added} added`);
    if (diff.counts.removed) parts.push(`${diff.counts.removed} removed`);
    if (diff.counts.modified) parts.push(`${diff.counts.modified} modified`);
    if (diff.counts.moved) parts.push(`${diff.counts.moved} moved`);
    if (diff.counts.settings) parts.push(`${diff.counts.settings} setting(s)`);
    return parts.join(', ');
}

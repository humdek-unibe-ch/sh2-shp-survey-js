/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Rich-text custom question type.
 *
 * Legacy parity: the old plugin shipped a Quill-based editor; this
 * version delegates to the host's `IRichTextEditorAdapter` (Tiptap-
 * powered) so we get the same WYSIWYG UX the rest of the CMS already
 * uses. SurveyJS sees the answer as a plain HTML string; the backend
 * sanitizer normalises it on submit.
 */

import type { ComponentCollection as ComponentCollectionType } from 'survey-core';
import type { IRichTextEditorAdapter } from '@selfhelp/shared/plugin-sdk';

interface IRegisterArgs {
    componentCollection: typeof ComponentCollectionType;
    richTextEditor: IRichTextEditorAdapter | null;
}

export function registerRichTextQuestion({
    componentCollection,
    richTextEditor,
}: IRegisterArgs): void {
    componentCollection.Instance.add({
        name: 'rich-text',
        title: 'Rich text',
        iconName: 'icon-richtext',
        questionJSON: {
            type: 'comment',
            rows: 6,
            placeholder: 'Type here…',
        },
        onLoaded(question) {
            const target = question as {
                getPropertyValue: (name: string) => unknown;
                setPropertyValue: (name: string, value: unknown) => void;
                value?: string;
                onPropertyChanged: { add: (cb: (q: unknown, args: { name: string }) => void) => void };
            };
            // Hint the renderer to use the rich editor instead of the
            // plain textarea SurveyJS would otherwise pick.
            target.setPropertyValue('renderAs', 'rich-text-editor');
            if (!richTextEditor) return;
            target.setPropertyValue('richTextEditorAdapter', 'host');
        },
    });
}

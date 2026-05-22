/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Custom question registration entry point.
 *
 * Called by `SurveyDesignerPage` (Creator side) and `SurveyJsStyle`
 * (runtime side) to register the plugin's three custom question
 * types — `rich-text`, `gpx`, and `video` — against
 * `survey-core`'s `ComponentCollection`.
 *
 * Feature flags from the host plugin runtime gate which custom
 * questions are exposed; disabled types are silently skipped so a
 * stale survey definition referencing them falls back to plain text
 * rather than crashing.
 *
 * Tiptap initialization happens lazily through the host's
 * `IRichTextEditorAdapter` (passed via `IPluginApi.richTextEditor`)
 * so the plugin never bundles its own editor instance.
 */

import type { IRichTextEditorAdapter } from '@selfhelp/shared/plugin-sdk';

interface IComponentRegistrar {
    ComponentCollection: {
        Instance: {
            add: (descriptor: { name: string; title: string; questionJSON: Record<string, unknown> }) => void;
        };
    };
}

export interface IRegisterOptions {
    flags: { gpx: boolean; video: boolean; richText: boolean };
    richTextEditor: IRichTextEditorAdapter | null;
}

export async function registerCustomQuestions(opts: IRegisterOptions): Promise<void> {
    const core = (await import('survey-core')) as unknown as IComponentRegistrar;
    const c = core.ComponentCollection.Instance;

    if (opts.flags.richText && opts.richTextEditor) {
        c.add({
            name: 'rich-text',
            title: 'Rich text',
            questionJSON: {
                type: 'comment',
                rows: 4,
                placeholder: 'Type here…',
            },
        });
    }
    if (opts.flags.gpx) {
        c.add({
            name: 'gpx',
            title: 'GPX track',
            questionJSON: {
                type: 'file',
                acceptedTypes: '.gpx',
                storeDataAsText: false,
                allowMultiple: false,
            },
        });
    }
    if (opts.flags.video) {
        c.add({
            name: 'video',
            title: 'Video reply',
            questionJSON: {
                type: 'file',
                acceptedTypes: 'video/*',
                storeDataAsText: false,
                allowMultiple: false,
            },
        });
    }
}

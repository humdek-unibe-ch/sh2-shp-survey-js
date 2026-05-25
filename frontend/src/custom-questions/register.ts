/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Central registration of every custom question type the plugin
 * contributes. Called from the Survey Designer (Creator side) and
 * from the runtime style (renderer side) so the same components
 * appear in both contexts.
 *
 * Feature flags from the host gate exposure: disabled types are
 * silently skipped so an existing survey definition referencing them
 * falls back to a plain `comment` / `file` question instead of
 * crashing the renderer.
 */

import type { IRichTextEditorAdapter } from '@selfhelp/shared/plugin-sdk';
import { registerRichTextQuestion } from './richText';
import { registerVideoQuestion, mountVideoQuestion } from './video';
import { registerGpxQuestion, mountGpxQuestion } from './gpx';
import { registerMicrophoneQuestion, mountMicrophoneQuestion } from './microphone';

export interface IRegisterOptions {
    flags: {
        gpx: boolean;
        video: boolean;
        richText: boolean;
        microphone: boolean;
    };
    richTextEditor: IRichTextEditorAdapter | null;
}

export async function registerCustomQuestions(opts: IRegisterOptions): Promise<void> {
    const core = await import('survey-core');
    const { ComponentCollection, Serializer } = core;

    if (opts.flags.richText) {
        registerRichTextQuestion({ componentCollection: ComponentCollection, richTextEditor: opts.richTextEditor });
    }
    if (opts.flags.video) {
        registerVideoQuestion({ componentCollection: ComponentCollection, serializer: Serializer });
    }
    if (opts.flags.gpx) {
        registerGpxQuestion({ componentCollection: ComponentCollection, serializer: Serializer });
    }
    if (opts.flags.microphone) {
        registerMicrophoneQuestion({ componentCollection: ComponentCollection, serializer: Serializer });
    }
}

export {
    mountVideoQuestion,
    mountGpxQuestion,
    mountMicrophoneQuestion,
};

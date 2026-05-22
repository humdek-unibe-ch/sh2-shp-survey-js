/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Wires the host-provided Tiptap rich-text adapter into SurveyJS
 * Creator property editors (plan §22.3.1).
 *
 * Behavior:
 *   - When the survey JSON declares `richTextEditor: true` at the
 *     survey-root level (per-survey opt-in), the registrar replaces
 *     the default HTML/comment editors on the Creator property grid
 *     with a Tiptap editor that the host hands us through
 *     `IPluginApi.richTextEditor`.
 *   - When the setting is missing or `false`, the registrar is a
 *     no-op and SurveyJS keeps its built-in editor.
 *
 * Properties wired:
 *   - `description` (string, supports HTML)
 *   - `title` (string, supports HTML)
 *   - `html` (string, only on Html question)
 *   - `correctAnswerText` (string)
 *
 * Implementation note:
 *   We register against `PropertyGridEditorCollection.register({ fit, getJSON, onCreated })`
 *   instead of patching the underlying question editor — this keeps
 *   us compatible with whichever Creator subversion the host loads.
 */

import type { IPluginApi } from '@selfhelp/shared/plugin-sdk';

interface IPropertyGridEditor {
    fit: (prop: { name?: string; type?: string }, context?: unknown) => boolean;
    getJSON?: () => Record<string, unknown>;
    onCreated?: (obj: unknown, question: unknown, prop: unknown) => void;
}

interface ICreatorModule {
    PropertyGridEditorCollection?: {
        register(editor: IPropertyGridEditor): void;
    };
    SurveyQuestionEditorDefinition?: {
        definition?: Record<string, unknown>;
    };
}

const TIPTAP_REGISTERED_KEY = '__sh2_shp_survey_js_tiptap_registered__';

const TIPTAP_PROPERTIES: Array<{ name: string; format: 'markdown' | 'sanitized-html' | 'prosemirror-json' }> = [
    { name: 'description', format: 'sanitized-html' },
    { name: 'title', format: 'sanitized-html' },
    { name: 'html', format: 'sanitized-html' },
    { name: 'correctAnswerText', format: 'sanitized-html' },
];

/**
 * Returns the per-survey opt-in flag. `surveyJson.richTextEditor === true`
 * enables the adapter; anything else leaves the default editor in place.
 */
export function isRichTextEditorEnabled(surveyJson: unknown): boolean {
    if (!surveyJson || typeof surveyJson !== 'object') return false;
    return (surveyJson as Record<string, unknown>).richTextEditor === true;
}

/**
 * Registers Tiptap-based property editors for the supplied SurveyJS
 * Creator module. Safe to call multiple times — the second call is a
 * no-op thanks to the module-level guard.
 */
export function registerTiptapPropertyEditors(
    creatorModule: ICreatorModule,
    api: IPluginApi,
): void {
    if (!creatorModule?.PropertyGridEditorCollection) {
        return;
    }
    const moduleGuard = creatorModule as Record<string, unknown>;
    if (moduleGuard[TIPTAP_REGISTERED_KEY] === true) {
        return;
    }
    moduleGuard[TIPTAP_REGISTERED_KEY] = true;

    const richTextEditor = api.richTextEditor;
    if (!richTextEditor) return;

    for (const wired of TIPTAP_PROPERTIES) {
        const editor: IPropertyGridEditor = {
            fit: (prop) => prop?.name === wired.name && (prop.type === 'string' || prop.type === 'text' || prop.type === undefined),
            getJSON: () => ({
                type: 'comment',
                rows: 6,
            }),
            onCreated: (_obj, _question, prop) => {
                queueMicrotask(() => {
                    const propEditor = prop as {
                        koValue?: { peek?: () => unknown; subscribe?: (cb: (v: unknown) => void) => unknown };
                        editorContainer?: HTMLElement | null;
                    };
                    const container = propEditor?.editorContainer;
                    if (!container) return;
                    const placeholder = container.querySelector('textarea');
                    if (!placeholder) return;
                    const mountNode = document.createElement('div');
                    mountNode.style.minHeight = '120px';
                    placeholder.style.display = 'none';
                    placeholder.parentElement?.insertBefore(mountNode, placeholder);

                    const initialValue = {
                        format: wired.format,
                        content: typeof placeholder.value === 'string' ? placeholder.value : '',
                    } as const;

                    const handle = richTextEditor.mount(mountNode, {
                        format: wired.format,
                        initialValue,
                        onChange: (next) => {
                            placeholder.value = next.content ?? '';
                            placeholder.dispatchEvent(new Event('change', { bubbles: true }));
                            placeholder.dispatchEvent(new Event('input', { bubbles: true }));
                        },
                    });

                    const cleanupObserver = new MutationObserver(() => {
                        if (!document.body.contains(mountNode)) {
                            handle.destroy();
                            cleanupObserver.disconnect();
                        }
                    });
                    cleanupObserver.observe(document.body, { childList: true, subtree: true });
                });
            },
        };
        creatorModule.PropertyGridEditorCollection.register(editor);
    }
}

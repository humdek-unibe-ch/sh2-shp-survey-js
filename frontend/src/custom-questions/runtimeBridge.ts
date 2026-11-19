/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Wires the plugin's file pipeline into a SurveyJS runtime model so
 * the custom question types (`gpx`, `video`, `microphone`) and the
 * built-in `file` type upload through the plugin's `/files` endpoint,
 * which stores each file as a core form file of the response, instead
 * of base64-embedding the payload into `data_cells`.
 *
 * The answer names each file by its key; the server drops the links on
 * save and adds fresh ones on load. Clearing a file only changes the
 * answer: the file stays in the response's history, like a core form edit.
 */

import type { ISurveyModel } from 'survey-core';
import type { IUploadedFile } from '../api/surveys';
import { mountGpxQuestion, mountMicrophoneQuestion, mountVideoQuestion } from './register';

export interface IRuntimeFileBridge {
    surveyKey: string;
    responseIdProvider: () => string;
    uploadFile: (questionName: string, file: File) => Promise<IUploadedFile>;
}

/** The server's reason for a refused upload (wrong type, too large, not your response), shown to the participant. */
export function uploadErrorMessage(error: unknown): string {
    const body = (error as { body?: { error?: unknown } } | null)?.body;
    return typeof body?.error === 'string' && body.error !== '' ? body.error : 'The file could not be uploaded.';
}

export function registerCustomQuestionRuntime(
    model: ISurveyModel,
    bridge: IRuntimeFileBridge,
): void {
    const upload = (questionName: string, file: File): Promise<IUploadedFile> =>
        bridge.uploadFile(questionName, file).catch((error: unknown) => {
            throw new Error(uploadErrorMessage(error));
        });
    // Per-question host element mount for the renderers that need a
    // dedicated UI (video player, GPX map, microphone recorder).
    model.onAfterRenderQuestion.add((sender, options) => {
        const q = options.question as {
            getType: () => string;
            name: string;
            value: unknown;
            readOnly: boolean;
            isRequired: boolean;
            getPropertyValue: (name: string) => unknown;
            customWidget?: unknown;
        };
        const type = q.getType();
        const setAnswer = (value: unknown): void => {
            const target = sender as unknown as { setValue?: (name: string, value: unknown) => void; data: Record<string, unknown> };
            if (typeof target.setValue === 'function') {
                target.setValue(q.name, value);
            } else {
                target.data = { ...target.data, [q.name]: value };
            }
        };
        switch (type) {
            case 'video':
                mountVideoQuestion(sender, options.htmlElement, q);
                break;
            case 'gpx':
                void mountGpxQuestion(options.htmlElement, q, {
                    setAnswer,
                    uploadFile: upload,
                });
                break;
            case 'microphone':
                void mountMicrophoneQuestion(options.htmlElement, q, {
                    setAnswer,
                    uploadFile: upload,
                });
                break;
            default:
                break;
        }
    });

    model.onUploadFiles.add((_sender, options) => {
        const files: File[] = Array.isArray(options.files) ? options.files : [];
        if (files.length === 0) {
            options.callback('error');
            return;
        }
        const question = options.question as { name?: string } | undefined;
        const questionName = options.name ?? question?.name ?? 'file';

        Promise.all(files.map((file) => upload(questionName, file).then((entry) => ({ file, entry }))))
            .then((uploaded) => {
                options.callback(
                    'success',
                    uploaded.map(({ file, entry }) => ({
                        file,
                        content: JSON.stringify({
                            key: entry.key,
                            url: entry.downloadUrl,
                            filename: entry.filename,
                            mimeType: entry.mimeType,
                        }),
                    })),
                );
            })
            .catch((error: unknown) => {
                options.callback('error', error instanceof Error ? error.message : uploadErrorMessage(error));
            });
    });

    model.onDownloadFile.add((_sender, options) => {
        // `content` is the pointer `{key, url, ...}` as JSON (or, from older answers, a URL).
        const value = options.content as string | { url?: string; content?: string } | undefined;
        let url = typeof value === 'string' ? value : value?.url ?? value?.content;
        if (typeof url === 'string' && url.startsWith('{')) {
            try {
                url = (JSON.parse(url) as { url?: string }).url;
            } catch {
                url = undefined;
            }
        }
        if (typeof url === 'string' && url !== '') {
            options.callback('success', url);
            return;
        }
        options.callback('error');
    });

    // The file stays in the response's history; clearing only changes the answer.
    model.onClearFiles.add((_sender, options) => {
        options.callback('success');
    });
}

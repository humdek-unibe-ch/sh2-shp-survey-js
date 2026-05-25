/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Wires the plugin's file pipeline into a SurveyJS runtime model so
 * the four custom question types (`gpx`, `video`, `microphone`,
 * `rich-text`) and the built-in `file` type all upload through the
 * plugin's secure `/files` endpoint instead of base64-embedding the
 * payload into `data_cells`.
 *
 * The SurveyJS `onUploadFiles` / `onDownloadFile` / `onClearFiles`
 * events are the only hooks we need: SurveyJS itself stays in charge
 * of question rendering, validation, and answer materialization.
 */

import type { ISurveyModel } from 'survey-core';
import type { IUploadedFile } from '../api/surveys';
import { mountGpxQuestion, mountMicrophoneQuestion, mountVideoQuestion } from './register';

export interface IRuntimeFileBridge {
    surveyKey: string;
    responseIdProvider: () => string;
    uploadFile: (questionName: string, file: File) => Promise<IUploadedFile>;
    deleteFile: (fileId: number) => Promise<void>;
}

export function registerCustomQuestionRuntime(
    model: ISurveyModel,
    bridge: IRuntimeFileBridge,
): void {
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
                    uploadFile: (name, file) => bridge.uploadFile(name, file).then((u) => ({
                        id: u.id,
                        downloadUrl: u.downloadUrl,
                        filename: u.filename,
                    })),
                });
                break;
            case 'microphone':
                void mountMicrophoneQuestion(options.htmlElement, q, {
                    setAnswer,
                    uploadFile: (name, file) => bridge.uploadFile(name, file).then((u) => ({
                        id: u.id,
                        downloadUrl: u.downloadUrl,
                        filename: u.filename,
                    })),
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
        const responseId = bridge.responseIdProvider();
        const question = options.question as { name?: string } | undefined;
        const questionName = options.name ?? question?.name ?? 'file';

        Promise.all(files.map((file) => bridge.uploadFile(questionName, file).then((entry) => ({ file, entry }))))
            .then((uploaded) => {
                options.callback(
                    'success',
                    uploaded.map(({ file, entry }) => ({
                        file,
                        content: JSON.stringify({
                            id: entry.id,
                            url: entry.downloadUrl,
                            filename: entry.filename,
                            mimeType: entry.mimeType,
                            sizeBytes: entry.sizeBytes,
                            sha256: entry.sha256,
                            responseId,
                        }),
                    })),
                );
            })
            .catch(() => {
                options.callback('error');
            });
    });

    model.onDownloadFile.add((_sender, options) => {
        const value = options.content as string | { url?: string; content?: string } | undefined;
        const url = typeof value === 'string' ? value : value?.url ?? value?.content;
        if (typeof url === 'string' && url !== '') {
            options.callback('success', url);
            return;
        }
        options.callback('error');
    });

    model.onClearFiles.add((_sender, options) => {
        const value = options.value as
            | { id?: number }
            | Array<{ id?: number }>
            | string
            | undefined;
        const ids: number[] = [];
        const collect = (entry: unknown): void => {
            if (entry && typeof entry === 'object' && 'id' in entry) {
                const candidate = (entry as { id?: unknown }).id;
                if (typeof candidate === 'number' && Number.isFinite(candidate)) {
                    ids.push(candidate);
                }
            } else if (typeof entry === 'string') {
                try {
                    collect(JSON.parse(entry));
                } catch {
                    // ignore — not a pointer payload.
                }
            }
        };
        if (Array.isArray(value)) {
            value.forEach((entry) => collect(entry));
        } else {
            collect(value);
        }
        if (ids.length === 0) {
            options.callback('success');
            return;
        }
        Promise.all(ids.map((id) => bridge.deleteFile(id).catch(() => undefined)))
            .then(() => options.callback('success'))
            .catch(() => options.callback('error'));
    });
}

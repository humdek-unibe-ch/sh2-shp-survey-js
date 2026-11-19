/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { describe, expect, it, vi } from 'vitest';
import type { ISurveyModel } from 'survey-core';
import { registerCustomQuestionRuntime } from '../src/custom-questions/runtimeBridge';

type THandler = (sender: unknown, options: Record<string, unknown>) => void;

function fakeModel(): { model: ISurveyModel; fire: (event: string, options: Record<string, unknown>) => void } {
    const handlers: Record<string, THandler[]> = {};
    const event = (name: string) => ({ add: (handler: THandler) => (handlers[name] ??= []).push(handler) });
    const model = {
        onAfterRenderQuestion: event('onAfterRenderQuestion'),
        onUploadFiles: event('onUploadFiles'),
        onDownloadFile: event('onDownloadFile'),
        onClearFiles: event('onClearFiles'),
    } as unknown as ISurveyModel;

    return { model, fire: (name, options) => handlers[name]?.forEach((handler) => handler(model, options)) };
}

const KEY = 'uploads/form-files/guest/table_3/record_7/field_photo/1_abcdef01_a.png';

describe('survey file bridge', () => {
    it('answers an upload with the file key and its link', async () => {
        const { model, fire } = fakeModel();
        registerCustomQuestionRuntime(model, {
            surveyKey: 'SV_1',
            responseIdProvider: () => 'R_1',
            uploadFile: () => Promise.resolve({ key: KEY, filename: 'a.png', mimeType: 'image/png', downloadUrl: '/api/x' }),
        });
        const callback = vi.fn();
        fire('onUploadFiles', { files: [new File(['x'], 'a.png')], name: 'photo', callback });
        await vi.waitFor(() => expect(callback).toHaveBeenCalled());

        const [status, entries] = callback.mock.calls[0] as [string, Array<{ content: string }>];
        expect(status).toBe('success');
        expect(JSON.parse(entries[0].content)).toEqual({ key: KEY, url: '/api/x', filename: 'a.png', mimeType: 'image/png' });
    });

    it('tells the participant why an upload was refused', async () => {
        const { model, fire } = fakeModel();
        const refused = Object.assign(new Error('HTTP 422'), { body: { error: 'File type not allowed. Allowed types: jpg, png' } });
        registerCustomQuestionRuntime(model, { surveyKey: 'SV_1', responseIdProvider: () => 'R_1', uploadFile: () => Promise.reject(refused) });
        const callback = vi.fn();
        fire('onUploadFiles', { files: [new File(['MZ'], 'run.exe')], name: 'photo', callback });
        await vi.waitFor(() => expect(callback).toHaveBeenCalled());

        expect(callback).toHaveBeenCalledWith('error', 'File type not allowed. Allowed types: jpg, png');
    });

    it('shows a stored file through the link in its pointer', () => {
        const { model, fire } = fakeModel();
        registerCustomQuestionRuntime(model, { surveyKey: 'SV_1', responseIdProvider: () => 'R_1', uploadFile: vi.fn() });
        const callback = vi.fn();
        fire('onDownloadFile', { content: JSON.stringify({ key: KEY, url: '/api/plugins/sh2-shp-survey-js/files?k=1' }), callback });

        expect(callback).toHaveBeenCalledWith('success', '/api/plugins/sh2-shp-survey-js/files?k=1');
    });

    it('clears a file without deleting it on the server', () => {
        const upload = vi.fn();
        const { model, fire } = fakeModel();
        registerCustomQuestionRuntime(model, { surveyKey: 'SV_1', responseIdProvider: () => 'R_1', uploadFile: upload });
        const callback = vi.fn();
        fire('onClearFiles', { value: [{ content: KEY }], callback });

        expect(callback).toHaveBeenCalledWith('success');
        expect(upload).not.toHaveBeenCalled();
    });
});

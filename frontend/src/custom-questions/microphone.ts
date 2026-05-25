/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Microphone (audio recording) custom question type.
 *
 * Ports the legacy `surveyjs-widgets` microphone behaviour to a
 * dependency-free WebRTC + `MediaRecorder` implementation. The
 * recorded blob is uploaded through the plugin's secure file pipeline
 * so the answer carries `{ url, durationMs }` — never a base64 blob
 * inside the data cell.
 */

import type { ComponentCollection as ComponentCollectionType, Serializer as SerializerType } from 'survey-core';

interface IRegisterArgs {
    componentCollection: typeof ComponentCollectionType;
    serializer: typeof SerializerType;
}

export function registerMicrophoneQuestion({ componentCollection, serializer }: IRegisterArgs): void {
    addProperty(serializer, 'microphone', {
        name: 'maxDurationSeconds:number',
        default: 60,
        category: 'general',
    });
    componentCollection.Instance.add({
        name: 'microphone',
        title: 'Voice recording',
        iconName: 'icon-microphone',
        questionJSON: {
            type: 'file',
            acceptedTypes: 'audio/*',
            storeDataAsText: false,
            allowMultiple: false,
        },
        onLoaded(question) {
            const target = question as { setPropertyValue: (name: string, value: unknown) => void };
            target.setPropertyValue('renderAs', 'sh2-microphone-question');
        },
    });
}

function addProperty(serializer: typeof SerializerType, className: string, descriptor: Record<string, unknown>): void {
    const existing = serializer.getProperty(className, String(descriptor.name).split(':')[0] ?? '');
    if (existing) return;
    serializer.addProperty(className, descriptor);
}

export async function mountMicrophoneQuestion(
    container: HTMLElement,
    question: {
        name: string;
        value: unknown;
        readOnly: boolean;
        getPropertyValue: (name: string) => unknown;
    },
    args: {
        uploadFile: (questionName: string, file: File) => Promise<{ id: number; downloadUrl: string; filename: string }>;
        setAnswer: (value: unknown) => void;
    },
): Promise<void> {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sh2-microphone-question';
    container.appendChild(wrap);

    const status = document.createElement('div');
    status.className = 'sh2-microphone-question__status';
    status.textContent = 'Ready.';

    const playback = document.createElement('audio');
    playback.controls = true;
    playback.preload = 'metadata';

    const btnRecord = document.createElement('button');
    btnRecord.type = 'button';
    btnRecord.textContent = 'Record';
    btnRecord.disabled = question.readOnly;

    const btnStop = document.createElement('button');
    btnStop.type = 'button';
    btnStop.textContent = 'Stop';
    btnStop.disabled = true;

    wrap.appendChild(btnRecord);
    wrap.appendChild(btnStop);
    wrap.appendChild(status);
    wrap.appendChild(playback);

    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let chunks: BlobPart[] = [];
    let startedAt = 0;
    const maxSeconds = Math.max(5, Number(question.getPropertyValue('maxDurationSeconds') ?? 60));

    btnRecord.addEventListener('click', async () => {
        chunks = [];
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            status.textContent = `Microphone unavailable: ${(err as Error).message}`;
            return;
        }
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        recorder.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener('stop', async () => {
            const blob = new Blob(chunks, { type: recorder?.mimeType ?? 'audio/webm' });
            const durationMs = Date.now() - startedAt;
            stream?.getTracks().forEach((track) => track.stop());
            stream = null;
            recorder = null;
            const fileName = `recording-${Date.now()}.webm`;
            const file = new File([blob], fileName, { type: blob.type });
            try {
                const uploaded = await args.uploadFile(question.name, file);
                args.setAnswer({
                    url: uploaded.downloadUrl,
                    fileId: uploaded.id,
                    filename: uploaded.filename,
                    durationMs,
                    mimeType: blob.type,
                });
                playback.src = uploaded.downloadUrl;
                status.textContent = `Recorded ${(durationMs / 1000).toFixed(1)} s.`;
            } catch (err) {
                status.textContent = `Upload failed: ${(err as Error).message}`;
            }
        });
        recorder.start();
        startedAt = Date.now();
        btnRecord.disabled = true;
        btnStop.disabled = false;
        status.textContent = 'Recording…';
        if (maxSeconds > 0) {
            window.setTimeout(() => {
                if (recorder && recorder.state === 'recording') {
                    recorder.stop();
                }
            }, maxSeconds * 1000);
        }
    });

    btnStop.addEventListener('click', () => {
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
        }
        btnStop.disabled = true;
        btnRecord.disabled = question.readOnly;
    });

    const initial = question.value as { url?: string; downloadUrl?: string } | null | undefined;
    if (initial?.url ?? initial?.downloadUrl) {
        playback.src = (initial.downloadUrl ?? initial.url) as string;
    }
}

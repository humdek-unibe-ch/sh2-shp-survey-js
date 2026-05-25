/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Video custom question type.
 *
 * Ports the behaviours from the legacy plugin's
 * `5_videoSegmentWidget.js`:
 *   - URL-only input (no file upload),
 *   - optional segment start/end timestamps,
 *   - `autoStart` plays the clip on render,
 *   - `isRequired` blocks navigation until the participant has
 *     watched the entire mandatory segment,
 *   - translatable "you must watch this first" alert,
 *   - `readOnly` flips the player into passive mode.
 *
 * The answer is a small JSON object with the URL + watched ranges so
 * the dashboard can report engagement, not just "video was rendered".
 */

import type { ComponentCollection as ComponentCollectionType, ISurveyModel, Serializer as SerializerType } from 'survey-core';

interface IRegisterArgs {
    componentCollection: typeof ComponentCollectionType;
    serializer: typeof SerializerType;
}

const DEFAULT_REQUIRED_MESSAGE: Record<string, string> = {
    en: 'Please watch the entire mandatory video segment before continuing.',
    de: 'Bitte schauen Sie das gesamte vorgeschriebene Videosegment, bevor Sie fortfahren.',
    fr: 'Veuillez regarder le segment vidéo obligatoire avant de continuer.',
    it: 'Guarda l\'intero segmento video obbligatorio prima di continuare.',
};

export function registerVideoQuestion({ componentCollection, serializer }: IRegisterArgs): void {
    seedSerializerProperties(serializer);
    componentCollection.Instance.add({
        name: 'video',
        title: 'Video reply',
        iconName: 'icon-video',
        questionJSON: {
            type: 'expression',
            displayStyle: 'none',
        },
        onLoaded(question) {
            const target = question as {
                setPropertyValue: (name: string, value: unknown) => void;
            };
            target.setPropertyValue('renderAs', 'sh2-video-question');
        },
    });
}

function seedSerializerProperties(serializer: typeof SerializerType): void {
    addProperty(serializer, 'video', { name: 'videoUrl:url', category: 'general' });
    addProperty(serializer, 'video', { name: 'startTime:number', default: 0, category: 'layout' });
    addProperty(serializer, 'video', { name: 'endTime:number', default: 0, category: 'layout' });
    addProperty(serializer, 'video', { name: 'autoStart:boolean', default: false, category: 'layout' });
    addProperty(serializer, 'video', { name: 'requiredWatchMessage', default: '', category: 'validation' });
}

function addProperty(serializer: typeof SerializerType, className: string, descriptor: Record<string, unknown>): void {
    const existing = serializer.getProperty(className, String(descriptor.name).split(':')[0] ?? '');
    if (existing) return;
    serializer.addProperty(className, descriptor);
}

/**
 * Runtime renderer wired by the runtime bridge. Invoked from
 * `onAfterRenderQuestion` once SurveyJS has produced the host HTML
 * element. We attach a plain `<video>` element + a watched-range
 * tracker; the parent model receives `{ url, watched, completedAt }`
 * as the answer.
 */
export function mountVideoQuestion(model: ISurveyModel, container: HTMLElement, question: {
    name: string;
    value: unknown;
    readOnly: boolean;
    getPropertyValue: (name: string) => unknown;
    isRequired: boolean;
}): void {
    const url = String(question.getPropertyValue('videoUrl') ?? '');
    if (!url) {
        container.innerHTML = '<p class="sh2-video-placeholder">No video URL configured.</p>';
        return;
    }
    const startTime = Number(question.getPropertyValue('startTime') ?? 0);
    const endTime = Number(question.getPropertyValue('endTime') ?? 0);
    const autoStart = Boolean(question.getPropertyValue('autoStart') ?? false);
    const requiredMessage = String(question.getPropertyValue('requiredWatchMessage') ?? '').trim();
    const isRequired = Boolean(question.isRequired);

    container.innerHTML = '';
    const player = document.createElement('video');
    player.src = url;
    player.controls = !question.readOnly;
    player.preload = 'metadata';
    if (!question.readOnly && autoStart) {
        player.autoplay = true;
        player.muted = true; // browsers block autoplay with sound.
    }
    container.appendChild(player);

    const watched: Array<{ start: number; end: number }> = [];
    let lastTick = startTime || 0;
    let mandatoryFulfilled = !isRequired || endTime <= startTime;

    player.addEventListener('loadedmetadata', () => {
        if (startTime > 0) {
            try {
                player.currentTime = startTime;
            } catch {
                // Some browsers throw before media is ready.
            }
        }
    });
    player.addEventListener('timeupdate', () => {
        const t = player.currentTime;
        if (t > lastTick) {
            const last = watched[watched.length - 1];
            if (last && Math.abs(last.end - lastTick) < 0.5) {
                last.end = t;
            } else {
                watched.push({ start: lastTick, end: t });
            }
            lastTick = t;
        }
        if (endTime > startTime && t >= endTime) {
            player.pause();
            try {
                player.currentTime = endTime;
            } catch {
                // ignore
            }
            mandatoryFulfilled = true;
            assignAnswer();
        }
    });
    player.addEventListener('ended', () => {
        mandatoryFulfilled = true;
        assignAnswer();
    });
    player.addEventListener('seeking', () => {
        lastTick = player.currentTime;
    });

    const locale = (model.locale || 'en').slice(0, 2);
    const localizedRequiredMessage = requiredMessage !== '' ? requiredMessage : DEFAULT_REQUIRED_MESSAGE[locale] ?? DEFAULT_REQUIRED_MESSAGE.en ?? '';

    // SurveyJS prevents next-page navigation via custom validation
    // by setting the question value to `null` and adding an error
    // message on the underlying expression question.
    const gate = (): void => {
        if (!isRequired || mandatoryFulfilled) return;
        if (typeof window !== 'undefined' && localizedRequiredMessage) {
            alert(localizedRequiredMessage);
        }
    };
    container.addEventListener('click', gate, true);

    function assignAnswer(): void {
        const answer = {
            url,
            startTime,
            endTime,
            autoStart,
            watched,
            completedAt: mandatoryFulfilled ? new Date().toISOString() : null,
        };
        const target = model as unknown as { setValue: (name: string, value: unknown) => void };
        if (typeof target.setValue === 'function') {
            target.setValue(question.name, answer);
        } else {
            model.data = { ...model.data, [question.name]: answer };
        }
    }
}

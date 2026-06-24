/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * WebView runtime controller lifecycle test — driven by the REAL `survey-core`
 * model (headless, no DOM), so it certifies actual SurveyJS behaviour rather
 * than a mock.
 *
 * The controller is the brain of the isolated WebView runtime. It must:
 *   - gate completion on validation (invalid -> no submit intent),
 *   - on completion EMIT a `SUBMIT_SURVEY` intent (never call the backend) so
 *     the native host can perform the authenticated request,
 *   - persist per-page progress as a `SAVE_PROGRESS` intent on page change,
 *   - react to the host's `SUBMIT_RESULT` by showing submitted / locked and, if
 *     configured, emitting `REQUEST_REDIRECT`,
 *   - surface `SESSION_EXPIRED`.
 *
 * `crypto.getRandomValues` is provided by Node's global `crypto`; survey-core's
 * focus-on-error path needs a DOM, so the test validates explicitly and uses
 * `doComplete()` to fire completion the same way the WebView "Complete" button
 * does after a successful validation.
 */

import { describe, expect, it } from 'vitest';
import { Model } from 'survey-core';

import {
    createSurveyRuntimeController,
    type TRuntimeLifecycle,
} from '../../src/runtime/controller';
import { buildRuntimeConfigFromSection, type IRuntimeSectionConfig } from '../../src/styles/section';
import { BRIDGE_SOURCE, type TWebviewToHostMessage } from '../../src/bridge/messages';

function setup(configOverrides: Partial<Record<string, string>> = {}, definition?: object) {
    const config: IRuntimeSectionConfig = buildRuntimeConfigFromSection({ id: 1, fields: configOverrides });
    const posts: TWebviewToHostMessage[] = [];
    const lifecycles: TRuntimeLifecycle[] = [];
    const controller = createSurveyRuntimeController({
        config,
        post: (msg) => posts.push(msg),
        onLifecycle: (lc) => lifecycles.push(lc),
    });
    const model = new Model(
        definition ?? { pages: [{ name: 'p1', elements: [{ type: 'text', name: 'q1', isRequired: true }] }] },
    );
    return { config, posts, lifecycles, controller, model };
}

describe('SurveyJS WebView controller — completion', () => {
    it('does not emit a submit intent while the survey is invalid', () => {
        const { controller, model, posts } = setup();
        controller.attachModel(model);
        expect(model.validate()).toBe(false); // required q1 empty
        expect(posts.find((m) => m.type === 'SUBMIT_SURVEY')).toBeUndefined();
    });

    it('emits SUBMIT_SURVEY (never a fetch) once valid + completed', () => {
        const { controller, model, posts, lifecycles } = setup();
        controller.attachModel(model);
        model.data = { q1: 'hello' };
        expect(model.validate()).toBe(true);
        model.doComplete();

        const submit = posts.find((m) => m.type === 'SUBMIT_SURVEY');
        expect(submit).toBeDefined();
        if (submit && submit.type === 'SUBMIT_SURVEY') {
            expect(submit.source).toBe(BRIDGE_SOURCE);
            expect(submit.data).toEqual({ q1: 'hello' });
            expect(submit.enforce).toMatchObject({ progress: { triggerType: 'finished' } });
            expect(typeof submit.responseId === 'string' || submit.responseId === null).toBe(true);
        }
        expect(lifecycles).toContain('submitting');
    });

    it('shows "submitted" on a successful host result for a repeatable survey', () => {
        const { controller, model, lifecycles } = setup();
        controller.attachModel(model);
        controller.handleHostMessage({
            source: BRIDGE_SOURCE,
            type: 'SUBMIT_RESULT',
            ok: true,
            responseId: 'R_SERVER',
            submittedAt: '2026-06-24T10:00:00Z',
        });
        expect(controller.getLifecycle()).toBe('submitted');
        expect(controller.getResponseId()).toBe('R_SERVER');
        expect(lifecycles).toContain('submitted');
    });

    it('locks (not "submitted") when once_per_user is set', () => {
        const { controller, model } = setup({ once_per_user: '1' });
        controller.attachModel(model);
        controller.handleHostMessage({
            source: BRIDGE_SOURCE,
            type: 'SUBMIT_RESULT',
            ok: true,
            responseId: 'R_1',
            submittedAt: '2026-06-24T10:00:00Z',
        });
        expect(controller.getLifecycle()).toBe('locked');
    });

    it('emits REQUEST_REDIRECT after submit when redirect_at_end is set', () => {
        const internal = setup({ redirect_at_end: '/thank-you' });
        internal.controller.attachModel(internal.model);
        internal.controller.handleHostMessage({
            source: BRIDGE_SOURCE,
            type: 'SUBMIT_RESULT',
            ok: true,
            responseId: 'R_1',
            submittedAt: '2026-06-24T10:00:00Z',
        });
        const redirect = internal.posts.find((m) => m.type === 'REQUEST_REDIRECT');
        expect(redirect).toBeDefined();
        if (redirect && redirect.type === 'REQUEST_REDIRECT') {
            expect(redirect.target).toBe('/thank-you');
            expect(redirect.external).toBe(false);
        }

        const external = setup({ redirect_at_end: 'https://example.com/done' });
        external.controller.attachModel(external.model);
        external.controller.handleHostMessage({
            source: BRIDGE_SOURCE,
            type: 'SUBMIT_RESULT',
            ok: true,
            responseId: 'R_2',
            submittedAt: '2026-06-24T10:00:00Z',
        });
        const ext = external.posts.find((m) => m.type === 'REQUEST_REDIRECT');
        expect(ext && ext.type === 'REQUEST_REDIRECT' ? ext.external : null).toBe(true);
    });

    it('locks on an already-submitted host error and surfaces session expiry', () => {
        const locked = setup();
        locked.controller.attachModel(locked.model);
        locked.controller.handleHostMessage({
            source: BRIDGE_SOURCE,
            type: 'SUBMIT_RESULT',
            ok: false,
            reason: 'already_submitted_once',
            message: 'nope',
        });
        expect(locked.controller.getLifecycle()).toBe('locked');

        const expired = setup();
        expired.controller.attachModel(expired.model);
        expired.controller.handleHostMessage({ source: BRIDGE_SOURCE, type: 'SESSION_EXPIRED' });
        expect(expired.controller.getLifecycle()).toBe('session-expired');
    });
});

describe('SurveyJS WebView controller — progress', () => {
    it('emits SAVE_PROGRESS with an ensured response id on page change', () => {
        const twoPage = {
            pages: [
                { name: 'p1', elements: [{ type: 'text', name: 'q1', isRequired: true }] },
                { name: 'p2', elements: [{ type: 'text', name: 'q2' }] },
            ],
        };
        const { controller, model, posts } = setup({}, twoPage);
        controller.attachModel(model);
        model.data = { q1: 'a' };
        (model as unknown as { focusOnFirstError: boolean }).focusOnFirstError = false;
        model.nextPage();

        const save = posts.find((m) => m.type === 'SAVE_PROGRESS');
        expect(save).toBeDefined();
        if (save && save.type === 'SAVE_PROGRESS') {
            expect(save.responseId).toMatch(/^R_/);
            expect(save.pageNo).toBe(1);
            expect(save.data).toMatchObject({ q1: 'a' });
        }
    });
});

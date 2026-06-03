/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Renderer snapshot for the SurveyJS read-only mobile viewer
 * (plan Slice 8D; audit Phase 8 "mobile renderer snapshots").
 *
 * The full React Native component render (RTL / jest-preset) is a
 * deliberate Slice 9 deferral — `mobile/vitest.config.ts` aliases
 * `react-native` to an inert stub so the package can be tested under Node
 * without the native runtime. Until that harness lands, the renderer's
 * behaviour is pinned here at the level that actually decides what the
 * viewer draws: the pure extraction helpers that build the survey-id and
 * the per-question card model from a published survey definition.
 *
 * `SurveyJsReadOnlyStyle` renders exactly one card per `extractQuestions`
 * entry (title ?? name, then the type line), so the snapshot below IS the
 * read-only viewer's render model — a regression in what gets rendered
 * turns this snapshot red.
 */

import { describe, expect, it } from 'vitest';

import { extractQuestions, extractSurveyId } from '../../src/styles/SurveyJsReadOnlyStyle';

describe('SurveyJS read-only viewer — survey id resolution', () => {
    it('reads a plain string field', () => {
        expect(extractSurveyId({ id: 1, fields: { 'survey-js': 'survey-42' } })).toBe('survey-42');
    });

    it('reads the CMS { content } field shape and trims it', () => {
        expect(
            extractSurveyId({ id: 1, fields: { 'survey-js': { content: '  survey-7  ' } } }),
        ).toBe('survey-7');
    });

    it('returns null when the survey id field is missing or blank', () => {
        expect(extractSurveyId({ id: 1, fields: {} })).toBeNull();
        expect(extractSurveyId({ id: 1, fields: { 'survey-js': '   ' } })).toBeNull();
        expect(extractSurveyId({ id: 1 })).toBeNull();
    });
});

describe('SurveyJS read-only viewer — render model', () => {
    it('ignores malformed elements and surveys with no pages', () => {
        expect(extractQuestions({})).toEqual([]);
        expect(
            extractQuestions({
                pages: [{ elements: [{ title: 'no name/type' }, { name: 'q', type: 'text' }] }],
            }),
        ).toEqual([{ name: 'q', title: undefined, type: 'text' }]);
    });

    it('matches the certified per-question render model snapshot', () => {
        const definition = {
            pages: [
                {
                    elements: [
                        { name: 'q1', title: 'Your name', type: 'text' },
                        { name: 'q2', title: 'Comments', type: 'comment' },
                    ],
                },
                {
                    elements: [
                        { name: 'q3', title: 'Pick one', type: 'radiogroup' },
                        { name: 'q4', type: 'checkbox' },
                        { name: 'q5', title: 'Notes', type: 'rich-text' },
                    ],
                },
            ],
        };

        expect(extractQuestions(definition)).toMatchInlineSnapshot(`
          [
            {
              "name": "q1",
              "title": "Your name",
              "type": "text",
            },
            {
              "name": "q2",
              "title": "Comments",
              "type": "comment",
            },
            {
              "name": "q3",
              "title": "Pick one",
              "type": "radiogroup",
            },
            {
              "name": "q4",
              "title": undefined,
              "type": "checkbox",
            },
            {
              "name": "q5",
              "title": "Notes",
              "type": "rich-text",
            },
          ]
        `);
    });
});

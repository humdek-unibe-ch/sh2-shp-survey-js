/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import { Model } from 'survey-core';
import { describe, expect, it } from 'vitest';

import { computeDefinitionDiff, normalizeDefinition, type TSurveyModelConstructor } from '../src/admin/definitionDiff';

const SurveyModel = Model as unknown as TSurveyModelConstructor;

// Saved with SurveyJS 2 property names and explicit defaults.
const savedWithSurveyJs2 = {
    showQuestionNumbers: true,
    pages: [
        {
            name: 'p1',
            elements: [
                { type: 'radiogroup', name: 'r', choices: ['a', 'b'], showClearButton: true },
                { type: 'boolean', name: 'b', renderAs: 'checkbox', label: 'I agree' },
                { type: 'rating', name: 'rate', rateCount: 5, displayMode: 'dropdown' },
                { type: 'text', name: 'followup', visibleIf: "{r} = 'b'" },
            ],
        },
    ],
};

function designModeJson(definition: unknown): Record<string, unknown> {
    const model = new SurveyModel();
    model.setDesignMode(true);
    model.fromJSON(definition);
    return model.toJSON();
}

describe('unpublished changes in the Designer', () => {
    it('reports none for a survey saved with SurveyJS 2 that nobody edited', () => {
        // What the SurveyJS 3 Creator holds after loading the definition (design mode).
        const creatorJson = designModeJson(savedWithSurveyJs2);

        expect(computeDefinitionDiff(savedWithSurveyJs2, creatorJson).hasChanges).toBe(true);
        const diff = computeDefinitionDiff(normalizeDefinition(savedWithSurveyJs2, SurveyModel), creatorJson);
        expect(diff.hasChanges).toBe(false);
    });

    it('still reports a real edit', () => {
        const edited = designModeJson(savedWithSurveyJs2) as { pages: Array<{ elements: Array<Record<string, unknown>> }> };
        edited.pages[0]!.elements[0]!.title = 'A new title';

        const diff = computeDefinitionDiff(normalizeDefinition(savedWithSurveyJs2, SurveyModel), edited);
        expect(diff.totalChanges).toBe(1);
    });

    it('treats a survey that was never published as having no baseline', () => {
        expect(normalizeDefinition(null, SurveyModel)).toBeNull();
    });
});

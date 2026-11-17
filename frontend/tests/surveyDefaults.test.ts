/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

import * as SurveyCore from 'survey-core';
import { describe, expect, it } from 'vitest';

import { ALL_QUESTION_TYPES_SURVEY } from '../preview/allQuestionTypes';
import { applyMantineSurveyDefaults } from '../src/theme/surveyDefaults';

interface ISurveyCoreForTest {
    Model: new (definition: unknown) => {
        questionErrorLocation: string;
        elementIdPrefix: string;
        toJSON: () => Record<string, unknown>;
        getAllQuestions: (visibleOnly?: boolean, includeDesignTime?: boolean, includeNested?: boolean) => Array<{ getType: () => string }>;
        getAllPanels: () => Array<{ getType: () => string }>;
    };
    Serializer: { findProperty: (className: string, name: string) => { defaultValue: unknown } | null };
    ElementFactory: { Instance: { getAllTypes: () => string[] } };
}

const core = SurveyCore as unknown as ISurveyCoreForTest;

describe('Mantine survey defaults', () => {
    it('shows a question error under the field unless the author chose another place', () => {
        applyMantineSurveyDefaults(core.Serializer);

        expect(new core.Model({}).questionErrorLocation).toBe('bottom');

        const authored = new core.Model({ questionErrorLocation: 'top' });
        expect(authored.questionErrorLocation).toBe('top');
        expect(authored.toJSON().questionErrorLocation).toBe('top');
    });

    it('keeps the default out of a saved survey, so the stored definition does not change', () => {
        applyMantineSurveyDefaults(core.Serializer);
        expect(new core.Model({ title: 'Saved' }).toJSON()).toEqual({ title: 'Saved' });
    });
});

describe('theme test survey', () => {
    it('shows every question type SurveyJS registers', () => {
        const model = new core.Model(ALL_QUESTION_TYPES_SURVEY);
        const shown = new Set([
            ...model.getAllQuestions(false, false, true).map((question) => question.getType()),
            ...model.getAllPanels().map((panel) => panel.getType()),
        ]);
        const missing = core.ElementFactory.Instance.getAllTypes().filter((type) => !shown.has(type));
        expect(missing).toEqual([]);
    });
});

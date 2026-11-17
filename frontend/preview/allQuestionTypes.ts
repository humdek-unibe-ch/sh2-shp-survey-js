/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * One survey that shows every SurveyJS question type, plus the states
 * a theme has to get right (required, error, read-only, description).
 * Used by the theme test page and by `tests/allQuestionTypes.test.ts`,
 * which fails when SurveyJS adds a type this survey does not show.
 */

const CHOICES = ['First option', 'Second option', 'Third option'];

export const ALL_QUESTION_TYPES_SURVEY = {
    title: 'Every question type',
    description: 'Theme test survey. Not for participants.',
    showProgressBar: true,
    progressBarLocation: 'top',
    showQuestionNumbers: true,
    pages: [
        {
            name: 'text',
            title: 'Text inputs',
            description: 'Single-line, multi-line and the HTML input types.',
            elements: [
                { type: 'text', name: 'text_plain', title: 'Text', description: 'A description under the title.', placeholder: 'Placeholder' },
                { type: 'text', name: 'text_required', title: 'Required text (submit empty to see the error)', isRequired: true },
                { type: 'text', name: 'text_readonly', title: 'Read-only text', readOnly: true, defaultValue: 'Cannot be changed' },
                { type: 'text', name: 'text_number', title: 'Number', inputType: 'number', startWithNewLine: false },
                { type: 'text', name: 'text_date', title: 'Date', inputType: 'date' },
                { type: 'text', name: 'text_time', title: 'Time', inputType: 'time', startWithNewLine: false },
                { type: 'text', name: 'text_email', title: 'Email', inputType: 'email', validators: [{ type: 'email' }] },
                { type: 'text', name: 'text_color', title: 'Color', inputType: 'color', startWithNewLine: false },
                { type: 'text', name: 'text_range', title: 'Range', inputType: 'range' },
                { type: 'comment', name: 'comment', title: 'Comment', placeholder: 'Several lines of text' },
                {
                    type: 'multipletext',
                    name: 'multipletext',
                    title: 'Multiple text',
                    items: [{ name: 'first', title: 'First name' }, { name: 'last', title: 'Last name' }],
                },
            ],
        },
        {
            name: 'choice',
            title: 'Choices',
            elements: [
                { type: 'radiogroup', name: 'radiogroup', title: 'Radio group', choices: CHOICES, showOtherItem: true, showClearButton: true },
                {
                    type: 'text',
                    name: 'radiogroup_followup',
                    title: 'Shown only when "Third option" is picked (condition)',
                    visibleIf: "{radiogroup} = 'Third option'",
                },
                { type: 'checkbox', name: 'checkbox', title: 'Checkboxes', choices: CHOICES, showSelectAllItem: true, showNoneItem: true, defaultValue: ['First option'] },
                { type: 'dropdown', name: 'dropdown', title: 'Dropdown', choices: CHOICES, placeholder: 'Pick one' },
                { type: 'tagbox', name: 'tagbox', title: 'Multi-select dropdown', choices: CHOICES, defaultValue: ['First option', 'Second option'], startWithNewLine: false },
                { type: 'boolean', name: 'boolean_switch', title: 'Yes/No as switch' },
                { type: 'boolean', name: 'boolean_radio', title: 'Yes/No as radio', renderAs: 'radio', startWithNewLine: false },
                { type: 'boolean', name: 'boolean_checkbox', title: 'Yes/No as checkbox', renderAs: 'checkbox', label: 'I agree' },
                { type: 'ranking', name: 'ranking', title: 'Ranking', choices: CHOICES },
                {
                    type: 'imagepicker',
                    name: 'imagepicker',
                    title: 'Image picker',
                    showLabel: true,
                    choices: [
                        { value: 'red', text: 'Red', imageLink: swatch('#fa5252') },
                        { value: 'green', text: 'Green', imageLink: swatch('#40c057') },
                        { value: 'blue', text: 'Blue', imageLink: swatch('#228be6') },
                    ],
                },
            ],
        },
        {
            name: 'scale',
            title: 'Scales',
            elements: [
                { type: 'rating', name: 'rating_numbers', title: 'Rating with numbers', rateCount: 5, minRateDescription: 'Low', maxRateDescription: 'High' },
                { type: 'rating', name: 'rating_stars', title: 'Rating with stars', rateType: 'stars', defaultValue: 3 },
                { type: 'rating', name: 'rating_smileys', title: 'Rating with smileys', rateType: 'smileys' },
                { type: 'rating', name: 'rating_dropdown', title: 'Rating as dropdown', displayMode: 'dropdown' },
                { type: 'slider', name: 'slider_single', title: 'Slider', sliderType: 'single', defaultValue: 40 },
                { type: 'slider', name: 'slider_range', title: 'Range slider', sliderType: 'range', defaultValue: [20, 70] },
            ],
        },
        {
            name: 'matrix',
            title: 'Matrices',
            elements: [
                {
                    type: 'matrix',
                    name: 'matrix',
                    title: 'Single-select matrix',
                    columns: ['Disagree', 'Neutral', 'Agree'],
                    // Row values without spaces: version 0.3.4 stores each row as a column named
                    // `matrix.<row value>`, and the core refuses keys with spaces (upgrade plan, problem 13).
                    rows: [
                        { value: 'sleep_well', text: 'I sleep well' },
                        { value: 'feel_rested', text: 'I feel rested' },
                    ],
                },
                {
                    type: 'matrixdropdown',
                    name: 'matrixdropdown',
                    title: 'Multi-select matrix',
                    columns: [
                        { name: 'how_often', title: 'How often', cellType: 'dropdown', choices: ['Never', 'Sometimes', 'Often'] },
                        { name: 'note', title: 'Note', cellType: 'text' },
                        { name: 'done', title: 'Done', cellType: 'checkbox', choices: ['Yes'] },
                    ],
                    rows: ['Morning', 'Evening'],
                },
                {
                    type: 'matrixdynamic',
                    name: 'matrixdynamic',
                    title: 'Dynamic matrix',
                    rowCount: 2,
                    columns: [
                        { name: 'activity', title: 'Activity', cellType: 'text' },
                        { name: 'minutes', title: 'Minutes', cellType: 'text', inputType: 'number' },
                    ],
                },
            ],
        },
        {
            name: 'layout',
            title: 'Panels and static content',
            elements: [
                {
                    type: 'panel',
                    name: 'panel',
                    title: 'Panel',
                    description: 'A group of questions.',
                    elements: [
                        { type: 'text', name: 'panel_text', title: 'Text inside a panel' },
                        { type: 'boolean', name: 'panel_boolean', title: 'Switch inside a panel' },
                    ],
                },
                {
                    type: 'paneldynamic',
                    name: 'paneldynamic',
                    title: 'Dynamic panel',
                    panelCount: 1,
                    templateElements: [{ type: 'text', name: 'child_name', title: 'Name' }],
                },
                { type: 'html', name: 'html', html: '<h4>HTML block</h4><p>Static <strong>content</strong> with a <a href="#">link</a>.</p>' },
                { type: 'image', name: 'image', imageLink: swatch('#fab005'), imageHeight: 80, imageWidth: 160 },
                { type: 'expression', name: 'expression', title: 'Expression (slider value doubled)', expression: '{slider_single} * 2' },
            ],
        },
        {
            name: 'upload',
            title: 'Files and signature',
            elements: [
                // Not stored as text: on a SelfHelp page the upload goes through the plugin's file route.
                { type: 'file', name: 'file', title: 'File upload', storeDataAsText: false },
                { type: 'signaturepad', name: 'signaturepad', title: 'Signature' },
            ],
        },
    ],
} as const;

/** A flat colour as an inline image, so the page needs no network. */
function swatch(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="${color}"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

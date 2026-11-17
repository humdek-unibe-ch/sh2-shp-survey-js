/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Fills every question of the SurveyJS survey on the current page with
 * sample answers, for manual testing. Development tool only: not part
 * of the plugin bundle.
 *
 * Use: open a page with a survey, paste this whole file into the
 * browser console and press Enter. It works for any survey, not only
 * the "Every question type" one. File upload and signature are left
 * empty (they need a real file or drawing).
 *
 * Options, set before pasting: `window.autofillSurveyComplete = true`
 * also presses Complete at the end.
 */
(() => {
    const root = document.querySelector('.sd-root-modern');
    if (!root) {
        console.warn('[autofill] No SurveyJS survey on this page.');
        return;
    }

    // The plugin does not expose its model, so read it from the React
    // props of the <Survey model={...}> component that drew this root.
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? root[fiberKey] : null;
    let survey = null;
    while (fiber && !survey) {
        const model = fiber.memoizedProps && fiber.memoizedProps.model;
        if (model && typeof model.getAllQuestions === 'function') survey = model;
        fiber = fiber.return;
    }
    if (!survey) {
        console.warn('[autofill] Found the survey on the page but not its model.');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const firstValues = (choices, count) => (choices || []).slice(0, count).map((choice) => choice.value);

    function textValue(question) {
        switch (question.inputType) {
            case 'number': return 42;
            case 'date': return today;
            case 'datetime-local': return `${today}T09:30`;
            case 'time': return '09:30';
            case 'month': return today.slice(0, 7);
            case 'email': return 'qa.user@selfhelp.test';
            case 'tel': return '+41 31 000 00 00';
            case 'url': return 'https://example.org';
            case 'color': return '#228be6';
            case 'range': return 50;
            case 'password': return 'sample';
            default: return `Sample answer to "${question.name}"`;
        }
    }

    function cellValue(column) {
        const type = column.cellType === 'default' || !column.cellType ? 'dropdown' : column.cellType;
        const choices = column.choices && column.choices.length > 0 ? column.choices : [{ value: 1 }];
        if (type === 'checkbox' || type === 'tagbox') return firstValues(choices, 1);
        if (type === 'boolean') return true;
        if (type === 'text' || type === 'comment' || type === 'expression') {
            return column.inputType === 'number' ? 30 : 'Sample';
        }
        return choices[0].value;
    }

    function rowFromColumns(columns) {
        const row = {};
        for (const column of columns) row[column.name] = cellValue(column);
        return row;
    }

    function sampleValue(question) {
        switch (question.getType()) {
            case 'text': return textValue(question);
            case 'comment': return 'A longer sample answer.\nIt has a second line.';
            case 'multipletext': {
                const value = {};
                for (const item of question.items) value[item.name] = `Sample ${item.name}`;
                return value;
            }
            case 'radiogroup':
            case 'dropdown':
            case 'imagepicker':
                return firstValues(question.visibleChoices, 1)[0];
            case 'checkbox':
            case 'tagbox':
                return firstValues(question.visibleChoices.filter((choice) => !['none', 'selectall', 'other'].includes(String(choice.value))), 2);
            case 'ranking':
                return question.visibleChoices.map((choice) => choice.value).reverse();
            case 'boolean': return true;
            case 'rating': {
                const values = question.visibleRateValues || [];
                return values.length > 0 ? values[values.length - 2 >= 0 ? values.length - 2 : 0].value : question.rateMax;
            }
            case 'slider': {
                const min = Number(question.min ?? 0);
                const max = Number(question.max ?? 100);
                return question.sliderType === 'range'
                    ? [Math.round(min + (max - min) * 0.25), Math.round(min + (max - min) * 0.75)]
                    : Math.round(min + (max - min) * 0.6);
            }
            case 'matrix': {
                const value = {};
                for (const row of question.visibleRows) value[row.name] = question.visibleColumns[0] && question.visibleColumns[0].value;
                return value;
            }
            case 'matrixdropdown': {
                const value = {};
                for (const row of question.rows) value[row.value] = rowFromColumns(question.columns);
                return value;
            }
            case 'matrixdynamic': {
                const count = Math.max(question.rowCount || 0, 2);
                return Array.from({ length: count }, () => rowFromColumns(question.columns));
            }
            case 'paneldynamic': {
                const panel = {};
                for (const element of question.templateElements) {
                    if (typeof element.getType === 'function') panel[element.name] = sampleValue(element);
                }
                return [panel];
            }
            default: return undefined; // file, signaturepad, html, image, expression
        }
    }

    const filled = [];
    const skipped = [];
    for (const question of survey.getAllQuestions(false)) {
        if (question.readOnly || question.isReadOnly) {
            skipped.push(`${question.name} (read-only)`);
            continue;
        }
        const value = sampleValue(question);
        if (value === undefined) {
            skipped.push(`${question.name} (${question.getType()})`);
            continue;
        }
        question.value = value;
        filled.push(question.name);
    }

    console.info(`[autofill] Filled ${filled.length} questions:`, filled);
    if (skipped.length > 0) console.info('[autofill] Left empty:', skipped);

    if (window.autofillSurveyComplete) {
        survey.currentPageNo = survey.visiblePages.length - 1;
        survey.completeLastPage();
    } else {
        console.info('[autofill] Go through the pages and press Complete, or set window.autofillSurveyComplete = true and run it again.');
    }
})();

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey defaults that belong to the Mantine look but are model
 * settings, not CSS. The colours and sizes are in
 * `mantine-adapter.css`.
 */

interface ISurveySerializer {
    findProperty: (className: string, propertyName: string) => { defaultValue: unknown } | null | undefined;
}

/**
 * Defaults that make a survey read like a Mantine form. Each changes
 * the default only, so an author can still pick another value in the
 * Creator. Call once after loading `survey-core`, before a model or a
 * Creator is built.
 *
 * - `questionErrorLocation: bottom`: the error goes under the field,
 *   where a Mantine input shows it (SurveyJS puts it above the title).
 *
 * The width is not set here: a survey fills its section, and the page
 * author decides the layout in the CMS tree (a `container` section
 * around it), as for any other style.
 */
export function applyMantineSurveyDefaults(serializer: ISurveySerializer): void {
    const defaults: Record<string, string> = {
        questionErrorLocation: 'bottom',
    };
    for (const [name, value] of Object.entries(defaults)) {
        const property = serializer.findProperty('survey', name);
        if (property) {
            property.defaultValue = value;
        }
    }
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `surveyjs` runtime style — thin shim that delegates to the full
 * SurveyJS runtime in `../runtime/SurveyRuntime.tsx`. The runtime
 * owns every lifecycle state (loading, locked, ready, submitted,
 * timed-out, …), the autosave loop, the file pipeline, and the
 * custom-question mounting. Keeping this shim minimal lets the
 * runtime module move freely (and lets `index.ts` import the
 * style by its legacy path).
 */

export { SurveyJsStyle } from '../runtime/SurveyRuntime';
export type { ISurveyJsStyleProps } from '../runtime/SurveyRuntime';

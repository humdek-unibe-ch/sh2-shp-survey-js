/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Ambient module for side-effect CSS imports.
 *
 * The interactive web runtime lazily `import('survey-core/survey-core.css')`
 * inside a try/catch so the Expo Metro web bundler injects the SurveyJS base
 * styles. The mobile tsconfig has no DOM/bundler CSS typing, so declare the
 * wildcard module to keep `tsc --noEmit` happy without pulling in a CSS loader.
 */
declare module '*.css';

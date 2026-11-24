/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

/**
 * SurveyJS keeps the comment of an "Other" choice under
 * `<question><commentSuffix>`, by default `-Comment`. Every answer key is a
 * column of the core data table, which takes only letters, digits, `_` and
 * `.`; with `-` the whole save is refused. The backend maps a leftover
 * `-Comment` to the same `_Comment` (`SurveyResponseStore::storedKey`).
 */
export const COMMENT_SUFFIX = '_Comment';

/** Applies the storage settings to the loaded `survey-core` module (idempotent). */
export function applyStorageSettings(core: { settings: { commentSuffix: string } }): void {
    core.settings.commentSuffix = COMMENT_SUFFIX;
}

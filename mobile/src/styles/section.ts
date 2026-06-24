/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Section-field extraction for the mobile SurveyJS runtime.
 *
 * Mirrors the frontend `buildRuntimeConfigFromSection` (and its field
 * readers) so the mobile renderer interprets the SAME CMS style fields
 * the web runtime does — `redirect_at_end`, `auto_save_interval`,
 * `restart_on_refresh`, `timeout`, the once-per-* gates, the schedule
 * window, and the status labels. Keeping the readers identical is what
 * makes "exactly the same functionality" hold across platforms.
 *
 * `extractSurveyId` stays the single source of truth in
 * `SurveyJsReadOnlyStyle` (the read-only viewer + its certified test
 * depend on it); we re-export it here so callers have one import.
 */

import { extractSurveyId } from './SurveyJsReadOnlyStyle';

export { extractSurveyId };

export interface ISectionLike {
    id?: number;
    fields?: Record<string, unknown>;
    style_name?: string;
    [key: string]: unknown;
}

export interface IRuntimeSectionConfig {
    restartOnRefresh: boolean;
    autoSaveIntervalSeconds: number;
    timeoutMinutes: number;
    savePdf: boolean;
    closeModalAtEnd: boolean;
    redirectAtEnd: string | null;
    urlParams: boolean;
    startTime: string | null;
    endTime: string | null;
    oncePerUser: boolean;
    oncePerSchedule: boolean;
    ownEntriesOnly: boolean;
    allowAnonymous: boolean;
    labelSurveyDone: string | null;
    labelSurveyNotActive: string | null;
}

export function extractFieldString(section: ISectionLike | undefined, key: string): string | null {
    const value = section?.fields?.[key] ?? section?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (
        value &&
        typeof value === 'object' &&
        'content' in (value as Record<string, unknown>) &&
        (typeof (value as { content?: unknown }).content === 'string' ||
            typeof (value as { content?: unknown }).content === 'number')
    ) {
        const content = (value as { content: string | number }).content;
        return String(content).trim() || null;
    }
    return null;
}

export function extractFieldBoolean(
    section: ISectionLike | undefined,
    key: string,
    fallback: boolean,
): boolean {
    const raw = extractFieldString(section, key);
    if (raw === null) return fallback;
    return raw === '1' || raw.toLowerCase() === 'true';
}

export function extractFieldNumber(
    section: ISectionLike | undefined,
    key: string,
    fallback: number,
): number {
    const raw = extractFieldString(section, key);
    if (raw === null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildRuntimeConfigFromSection(section?: ISectionLike): IRuntimeSectionConfig {
    return {
        restartOnRefresh: extractFieldBoolean(section, 'restart_on_refresh', false),
        autoSaveIntervalSeconds: extractFieldNumber(section, 'auto_save_interval', 0),
        timeoutMinutes: extractFieldNumber(section, 'timeout', 0),
        savePdf: extractFieldBoolean(section, 'save_pdf', false),
        closeModalAtEnd: extractFieldBoolean(section, 'close_modal_at_end', false),
        redirectAtEnd: extractFieldString(section, 'redirect_at_end'),
        urlParams: extractFieldBoolean(section, 'url_params', false),
        startTime: extractFieldString(section, 'start_time'),
        endTime: extractFieldString(section, 'end_time'),
        oncePerUser: extractFieldBoolean(section, 'once_per_user', false),
        oncePerSchedule: extractFieldBoolean(section, 'once_per_schedule', false),
        ownEntriesOnly: extractFieldBoolean(section, 'own_entries_only', false),
        allowAnonymous: extractFieldBoolean(section, 'allow_anonymous', true),
        labelSurveyDone: extractFieldString(section, 'label_survey_done'),
        labelSurveyNotActive: extractFieldString(section, 'label_survey_not_active'),
    };
}

/**
 * Server-side runtime-config echo (sent as `X-SurveyJs-Runtime-Config`)
 * so the backend re-validates the submission against the SAME config the
 * section declares. Mirrors the frontend `configToServerConfig`.
 */
export function configToServerConfig(config: IRuntimeSectionConfig): Record<string, unknown> {
    return {
        restartOnRefresh: config.restartOnRefresh,
        autoSaveIntervalSeconds: config.autoSaveIntervalSeconds,
        timeoutMinutes: config.timeoutMinutes,
        savePdf: config.savePdf,
        closeModalAtEnd: config.closeModalAtEnd,
        redirectAtEnd: config.redirectAtEnd,
        urlParams: config.urlParams,
        startTime: config.startTime,
        endTime: config.endTime,
        oncePerUser: config.oncePerUser,
        oncePerSchedule: config.oncePerSchedule,
        ownEntriesOnly: config.ownEntriesOnly,
        allowAnonymous: config.allowAnonymous,
        labelSurveyDone: config.labelSurveyDone,
        labelSurveyNotActive: config.labelSurveyNotActive,
    };
}

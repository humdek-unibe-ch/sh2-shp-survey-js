/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Environment configuration for the SurveyJS Creator E2E (plan Slice 8D).
 *
 * Everything is env-driven so the same spec runs against any QA stack
 * without hard-coded hosts/paths (canonical Testing Rule 14). The admin
 * account must hold `surveyjs.surveys.manage` to reach the Creator. The
 * spec self-skips unless the required QA admin env is present, so
 * `npm run test:e2e` is safe on a machine without a stack.
 */

export interface ICreatorE2eEnv {
    baseUrl: string;
    loginKeyword: string;
    email: string;
    password: string;
    /** Host route the plugin mounts its consolidated admin page on. */
    adminPath: string;
    /**
     * Optional id of a QA survey to open directly in the Designer. When
     * absent, the spec verifies the admin page + Designer tab reachability
     * without depending on seeded survey rows.
     */
    surveyId: string | null;
}

export function creatorEnv(): ICreatorE2eEnv {
    return {
        baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
        loginKeyword: process.env.QA_LOGIN_KEYWORD ?? 'login',
        email: process.env.QA_ADMIN_EMAIL ?? 'qa.admin@qa.selfhelp.test',
        password: process.env.QA_ADMIN_PASSWORD ?? 'change-me',
        adminPath:
            process.env.QA_SURVEYJS_ADMIN_PATH ?? '/admin/plugins-host/sh2-shp-survey-js/surveys',
        surveyId: process.env.QA_SURVEY_ID ?? null,
    };
}

/** The Creator E2E only runs when explicitly pointed at a prepared QA stack. */
export function isCreatorE2eConfigured(): boolean {
    return Boolean(process.env.QA_ADMIN_EMAIL && process.env.QA_ADMIN_PASSWORD);
}

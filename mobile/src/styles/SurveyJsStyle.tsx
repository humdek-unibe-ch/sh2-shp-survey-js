/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `surveyjs` mobile style dispatcher.
 *
 * The SurveyJS React library (`survey-react-ui`) renders to the DOM, so
 * the fully-interactive runtime only works where a DOM exists — the Expo
 * **web** export (react-native-web), which is exactly what the
 * `selfhelp-mobile-preview` image ships. On native (iOS/Android) there is
 * no DOM, so we fall back to the read-only viewer, which lists the survey
 * and offers an "Open on web" prompt.
 *
 *   web    → SurveyJsRuntimeStyle  (fetch + render + per-page save + submit)
 *   native → SurveyJsReadOnlyStyle (read-only preview + open-on-web)
 */

import { Platform } from 'react-native';

import type { ISectionLike } from './section';
import { SurveyJsReadOnlyStyle } from './SurveyJsReadOnlyStyle';
import { SurveyJsRuntimeStyle } from './SurveyJsRuntimeStyle';

export interface ISurveyJsStyleProps {
    section: ISectionLike;
    values?: Record<string, unknown>;
}

export function SurveyJsStyle({ section, values }: ISurveyJsStyleProps): React.ReactElement | null {
    if (Platform.OS === 'web') {
        return <SurveyJsRuntimeStyle section={section} values={values} />;
    }
    return <SurveyJsReadOnlyStyle section={section} values={values} />;
}

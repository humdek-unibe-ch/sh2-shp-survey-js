/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The SurveyJS admin page: the survey list, or one survey with its tabs.
 *
 * The host gives a plugin page one path segment, so where the page is lives
 * in the query string ({@link parseAdminLocation}). Opening a survey and
 * going back to the list are history entries, so the browser's back and
 * forward buttons work; switching tabs replaces the entry.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box } from '@mantine/core';

import { formatAdminLocation, parseAdminLocation, type IAdminLocation, type TSurveyView } from './adminUrl';
import { SurveyDetailPage } from './SurveyDetailPage';
import { SurveyListPage } from './SurveyListPage';

function currentLocation(): IAdminLocation {
    return typeof window === 'undefined' ? { surveyId: null, view: 'design' } : parseAdminLocation(window.location.search);
}

export function SurveyAdminPage(): React.ReactElement {
    const [location, setLocation] = useState<IAdminLocation>(currentLocation);

    // An old link (`view=dashboard`, …) shows the matching tab; write its current name into the address bar.
    useEffect(() => {
        const start = currentLocation();
        const url = `${window.location.pathname}${formatAdminLocation(start, window.location.search)}`;
        if (url !== `${window.location.pathname}${window.location.search}`) {
            window.history.replaceState(null, '', url);
        }
    }, []);

    useEffect(() => {
        const onPopState = (): void => setLocation(currentLocation());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const go = useCallback((next: IAdminLocation, mode: 'push' | 'replace'): void => {
        const url = `${window.location.pathname}${formatAdminLocation(next, window.location.search)}`;
        if (mode === 'push') {
            window.history.pushState(null, '', url);
        } else {
            window.history.replaceState(null, '', url);
        }
        setLocation(next);
    }, []);

    return (
        <Box p="lg" pb="xl" maw={1600} mx="auto" w="100%">
            {location.surveyId === null ? (
                <SurveyListPage onOpen={(surveyId: number, view: TSurveyView) => go({ surveyId, view }, 'push')} />
            ) : (
                <SurveyDetailPage
                    key={location.surveyId}
                    surveyId={location.surveyId}
                    view={location.view}
                    onViewChange={(view) => go({ surveyId: location.surveyId, view }, 'replace')}
                    onBack={() => go({ surveyId: null, view: 'design' }, 'push')}
                />
            )}
        </Box>
    );
}

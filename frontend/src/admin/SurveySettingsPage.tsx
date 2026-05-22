/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Plugin-level settings page. The actual feature-flag editor lives
 * in the host's plugin detail UI; this page surfaces a contextual
 * summary so admins can jump straight to the global setting from
 * inside the SurveyJS host shell.
 */

import { useEffect, useState } from 'react';

import { fetchLicenseKey } from '../api/surveys-admin';

export function SurveySettingsPage(): React.ReactElement {
    const [license, setLicense] = useState<{ configured: boolean } | null>(null);

    useEffect(() => {
        fetchLicenseKey()
            .then((data) => setLicense({ configured: data.configured }))
            .catch(() => setLicense({ configured: false }));
    }, []);

    return (
        <div style={{ padding: 16 }}>
            <h2>SurveyJS Settings</h2>
            <section>
                <h3>License key</h3>
                <p>
                    Configure <code>SURVEYJS_LICENSE_KEY</code> in the backend environment to remove the
                    SurveyJS unlicensed watermark. Status:{' '}
                    {license === null ? 'checking…' : license.configured ? <strong>configured</strong> : <em>not configured</em>}.
                </p>
            </section>
            <section>
                <h3>Feature flags</h3>
                <p>
                    Toggle the GPX, Video, Rich-text, PDF export, Dashboard, and Collaborative-editing flags
                    from the host's <em>Plugins → SurveyJS</em> detail page.
                </p>
            </section>
        </div>
    );
}

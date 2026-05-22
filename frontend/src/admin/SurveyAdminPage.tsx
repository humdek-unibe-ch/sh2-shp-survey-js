/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Surveys list — main entry point of the plugin's admin UI.
 *
 * Shows the surveys this host owns + their current revision and
 * archive state. Buttons link to the Designer / Responses / Dashboard
 * sub-pages mounted under the same plugin host shell.
 */

import { useEffect, useState } from 'react';

import { listSurveys, type IAdminSurveySummary } from '../api/surveys-admin';

export function SurveyAdminPage(): React.ReactElement {
    const [items, setItems] = useState<IAdminSurveySummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        listSurveys()
            .then(setItems)
            .catch((err: Error) => setError(err.message));
    }, []);

    if (error) {
        return (
            <div role="alert" style={{ padding: 16, border: '1px solid #fa5252', borderRadius: 4 }}>
                Failed to load surveys: {error}
            </div>
        );
    }
    if (items === null) {
        return <div aria-busy>Loading surveys…</div>;
    }
    if (items.length === 0) {
        return (
            <div style={{ padding: 16 }}>
                <h2>Surveys</h2>
                <p>No surveys yet. Use the Designer page to create your first survey.</p>
            </div>
        );
    }

    return (
        <div style={{ padding: 16 }}>
            <h2>Surveys</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid #dee2e6' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>Name</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Key</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Revision</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Updated</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>State</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((survey) => (
                        <tr key={survey.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                            <td style={{ padding: 8 }}>{survey.name}</td>
                            <td style={{ padding: 8 }}>
                                <code>{survey.keySlug}</code>
                            </td>
                            <td style={{ padding: 8 }}>{survey.currentRevision ?? '—'}</td>
                            <td style={{ padding: 8 }}>{new Date(survey.updatedAt).toLocaleString()}</td>
                            <td style={{ padding: 8 }}>
                                {survey.archived ? <em>archived</em> : <strong>active</strong>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

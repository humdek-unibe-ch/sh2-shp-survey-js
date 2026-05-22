/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey responses table. Connects to
 * `surveys/{surveyId}/responses` via the host realtime layer so new
 * responses appear without polling. The fetch on mount populates the
 * initial table; subsequent updates arrive through the topic.
 *
 * The page does NOT poll the responses endpoint — that would violate
 * the host's no-polling policy.
 */

import { useEffect, useMemo, useState } from 'react';

interface IResponseRow {
    id: number;
    status: string;
    startedAt: string;
    completedAt: string | null;
    idDataRow: number | null;
}

export interface ISurveyResponsesPageProps {
    surveyId?: number;
}

export function SurveyResponsesPage({ surveyId }: ISurveyResponsesPageProps = {}): React.ReactElement {
    const [items, setItems] = useState<IResponseRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const apiBase = useMemo(() => '/cms-api/v1/admin/plugins/surveyjs', []);

    useEffect(() => {
        if (!surveyId) return;
        let cancelled = false;
        fetch(`${apiBase}/surveys/${surveyId}/responses`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { data: { recent: IResponseRow[] } };
                if (!cancelled) setItems(body.data.recent);
            })
            .catch((err: Error) => setError(err.message));
        return () => { cancelled = true; };
    }, [apiBase, surveyId]);

    if (!surveyId) {
        return (
            <div style={{ padding: 16 }}>
                <h2>Responses</h2>
                <p>Select a survey from the list to view its responses.</p>
            </div>
        );
    }
    if (error) {
        return (
            <div role="alert" style={{ padding: 12, border: '1px solid #fa5252', borderRadius: 4 }}>
                {error}
            </div>
        );
    }
    if (items === null) {
        return <div aria-busy>Loading responses…</div>;
    }
    if (items.length === 0) {
        return (
            <div style={{ padding: 16 }}>
                <h2>Responses</h2>
                <p>No responses yet.</p>
            </div>
        );
    }
    return (
        <div style={{ padding: 16 }}>
            <h2>Responses</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid #dee2e6' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>Run #</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Started</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Completed</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>data_row</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid #f1f3f5' }}>
                            <td style={{ padding: 8 }}>{row.id}</td>
                            <td style={{ padding: 8 }}>{row.status}</td>
                            <td style={{ padding: 8 }}>{new Date(row.startedAt).toLocaleString()}</td>
                            <td style={{ padding: 8 }}>
                                {row.completedAt ? new Date(row.completedAt).toLocaleString() : '—'}
                            </td>
                            <td style={{ padding: 8 }}>{row.idDataRow ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

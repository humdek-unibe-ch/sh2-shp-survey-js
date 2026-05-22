/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Survey dashboard — completed-responses count + a small "recent
 * responses" preview. The full chart-rendering pass is deferred until
 * we wire the host's Mantine Charts adapter; this scaffold proves the
 * data shape end-to-end.
 */

import { useEffect, useState } from 'react';

interface IDashboardSummary {
    surveyId: number;
    completedResponses: number;
    currentVersionRevision: number | null;
    recent: Array<{ id: number; startedAt: string; status: string }>;
}

export interface ISurveyDashboardPageProps {
    surveyId?: number;
}

export function SurveyDashboardPage({ surveyId }: ISurveyDashboardPageProps = {}): React.ReactElement {
    const [summary, setSummary] = useState<IDashboardSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!surveyId) return;
        let cancelled = false;
        fetch(`/cms-api/v1/admin/plugins/surveyjs/surveys/${surveyId}/dashboard`, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { data: IDashboardSummary };
                if (!cancelled) setSummary(body.data);
            })
            .catch((err: Error) => setError(err.message));
        return () => { cancelled = true; };
    }, [surveyId]);

    if (!surveyId) {
        return (
            <div style={{ padding: 16 }}>
                <h2>Dashboard</h2>
                <p>Select a survey from the list to view its dashboard.</p>
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
    if (!summary) {
        return <div aria-busy>Loading dashboard…</div>;
    }
    return (
        <div style={{ padding: 16 }}>
            <h2>Dashboard</h2>
            <p>
                Completed responses: <strong>{summary.completedResponses}</strong> · current revision:{' '}
                <strong>{summary.currentVersionRevision ?? '—'}</strong>
            </p>
            <h3>Recent responses</h3>
            <ul>
                {summary.recent.map((row) => (
                    <li key={row.id}>
                        Run #{row.id} — {row.status} — {new Date(row.startedAt).toLocaleString()}
                    </li>
                ))}
            </ul>
        </div>
    );
}

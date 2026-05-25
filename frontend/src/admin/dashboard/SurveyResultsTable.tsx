/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Tabulator-backed results table for the Dashboard tab.
 *
 * The legacy plugin used SurveyAnalyticsTabulator on top of
 * `tabulator-tables`. We try to load that pair lazily so consumers
 * who do not need the dashboard never pay for the bundle. When
 * Tabulator isn't installed (or licensing precludes it) we fall back
 * to a Mantine `Table` so the data is still browsable.
 *
 * Column model: internal columns first (`record_id`, `response_id`,
 * `date`, `id_users`, `visitor_id`, `page_no`, `trigger_type`,
 * `status`, `revision`) followed by one column per question name
 * discovered in the result set. Layout choices are persisted to
 * `localStorage` under `sh2-shp-survey-js:dashboard:<surveyId>` so the
 * operator's table preferences survive reloads.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Table, Text } from '@mantine/core';

import type { IDashboardResults } from '../../api/surveys-admin';

const INTERNAL_COLUMNS = [
    'record_id',
    'response_id',
    'date',
    'id_users',
    'visitor_id',
    'page_no',
    'trigger_type',
    'status',
    'revision',
];

interface ITabulatorBridge {
    Tabulator: new (element: HTMLElement, options: Record<string, unknown>) => {
        destroy: () => void;
        replaceData: (data: Array<Record<string, unknown>>) => Promise<unknown>;
        download: (format: string, filename: string, options?: Record<string, unknown>) => void;
        setColumns: (columns: Array<Record<string, unknown>>) => void;
    };
}

async function loadTabulator(): Promise<ITabulatorBridge | null> {
    try {
        const mod = (await import('tabulator-tables')) as unknown as ITabulatorBridge;
        return mod;
    } catch {
        return null;
    }
}

export interface ISurveyResultsTableProps {
    surveyId: number;
    results: IDashboardResults;
    onSelectResponse?: (responseId: string) => void;
}

export function SurveyResultsTable({ surveyId, results, onSelectResponse }: ISurveyResultsTableProps): React.ReactElement {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [bridge, setBridge] = useState<ITabulatorBridge | null>(null);
    const [bridgeError, setBridgeError] = useState<boolean>(false);
    const tableRef = useRef<ReturnType<ITabulatorBridge['Tabulator']['prototype']['constructor']> | null>(null);
    const storageKey = `sh2-shp-survey-js:dashboard:${surveyId}`;

    const columns = useMemo(() => buildColumns(results), [results]);

    useEffect(() => {
        let cancelled = false;
        void loadTabulator().then((b) => {
            if (cancelled) return;
            if (b === null) {
                setBridgeError(true);
                return;
            }
            setBridge(b);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!bridge || !containerRef.current) return;
        const persisted = readLayout(storageKey);
        const orderedColumns = mergeColumnsWithLayout(columns, persisted);
        const layoutPersister = (def: Array<Record<string, unknown>>): void => {
            saveLayout(storageKey, def.map((c) => String(c.field ?? '')));
        };
        const instance = new bridge.Tabulator(containerRef.current, {
            data: results.rows,
            columns: orderedColumns,
            layout: 'fitDataStretch',
            movableColumns: true,
            pagination: 'local',
            paginationSize: 50,
            paginationSizeSelector: [25, 50, 100, 200],
            persistence: false,
            columnMoved: (_col: unknown, definitions: Array<Record<string, unknown>>) => layoutPersister(definitions),
            rowClick: (_event: unknown, row: { getData: () => Record<string, unknown> }) => {
                const data = row.getData();
                const responseId = String(data.response_id ?? '');
                if (responseId !== '' && onSelectResponse) {
                    onSelectResponse(responseId);
                }
            },
        });
        tableRef.current = instance;
        return () => {
            instance.destroy();
            tableRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bridge]);

    useEffect(() => {
        if (!tableRef.current) return;
        void tableRef.current.replaceData(results.rows);
    }, [results]);

    if (bridgeError) {
        return <FallbackTable results={results} />;
    }
    if (!bridge) {
        return (
            <Text c="dimmed" size="sm">
                Loading dashboard table…
            </Text>
        );
    }
    return <div ref={containerRef} style={{ minHeight: 320 }} />;
}

function buildColumns(results: IDashboardResults): Array<Record<string, unknown>> {
    const questionColumns = new Set<string>();
    for (const row of results.rows) {
        for (const key of Object.keys(row)) {
            if (!INTERNAL_COLUMNS.includes(key)) {
                questionColumns.add(key);
            }
        }
    }
    return [
        ...INTERNAL_COLUMNS.map((field) => ({
            title: humanise(field),
            field,
            sorter: 'string',
            headerFilter: 'input',
        })),
        ...Array.from(questionColumns).sort().map((field) => ({
            title: lookupQuestionTitle(results.definition, field) ?? field,
            field,
            sorter: 'string',
            headerFilter: 'input',
            formatter: (cell: { getValue: () => unknown }) => formatCell(cell.getValue()),
        })),
    ];
}

function mergeColumnsWithLayout(
    columns: Array<Record<string, unknown>>,
    persisted: string[],
): Array<Record<string, unknown>> {
    if (persisted.length === 0) return columns;
    const byField = new Map<string, Record<string, unknown>>();
    columns.forEach((c) => byField.set(String(c.field ?? ''), c));
    const out: Array<Record<string, unknown>> = [];
    for (const field of persisted) {
        const found = byField.get(field);
        if (found) {
            out.push(found);
            byField.delete(field);
        }
    }
    byField.forEach((value) => out.push(value));
    return out;
}

function lookupQuestionTitle(definition: Record<string, unknown>, name: string): string | null {
    const pages = (definition.pages as Array<Record<string, unknown>> | undefined) ?? [];
    for (const page of pages) {
        const elements = (page.elements as Array<Record<string, unknown>> | undefined) ?? [];
        for (const element of elements) {
            if (element.name === name) {
                const title = element.title;
                if (typeof title === 'string') return title;
                if (title && typeof title === 'object') {
                    const localised = (title as Record<string, unknown>).default ?? (title as Record<string, unknown>).en;
                    if (typeof localised === 'string') return localised;
                }
            }
        }
    }
    return null;
}

function humanise(value: string): string {
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/cms-api')) {
            return `<a href="${value}" target="_blank" rel="noopener noreferrer">${value.split('/').pop() ?? value}</a>`;
        }
        return escapeHtml(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.url === 'string' && typeof obj.mimeType === 'string') {
            if (obj.mimeType.startsWith('audio/')) {
                return `<audio controls preload="metadata" src="${obj.url}"></audio>`;
            }
            return `<a href="${obj.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(String(obj.filename ?? 'file'))}</a>`;
        }
        return escapeHtml(JSON.stringify(value));
    }
    return '';
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function readLayout(key: string): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
            return parsed;
        }
    } catch {
        return [];
    }
    return [];
}

function saveLayout(key: string, fields: string[]): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(fields));
    } catch {
        // ignore quota errors
    }
}

function FallbackTable({ results }: { results: IDashboardResults }): React.ReactElement {
    const headers = useMemo(() => {
        const set = new Set<string>(INTERNAL_COLUMNS);
        for (const row of results.rows) {
            for (const key of Object.keys(row)) set.add(key);
        }
        return Array.from(set);
    }, [results]);

    if (results.rows.length === 0) {
        return (
            <Alert color="gray" title="No responses yet">
                Once participants submit responses they will appear here.
            </Alert>
        );
    }
    return (
        <Table verticalSpacing="sm" striped highlightOnHover withTableBorder>
            <Table.Thead>
                <Table.Tr>
                    {headers.map((h) => (
                        <Table.Th key={h}>{humanise(h)}</Table.Th>
                    ))}
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {results.rows.map((row, idx) => (
                    <Table.Tr key={String(row.response_id ?? idx)}>
                        {headers.map((h) => (
                            <Table.Td key={h}>{String(row[h] ?? '')}</Table.Td>
                        ))}
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}

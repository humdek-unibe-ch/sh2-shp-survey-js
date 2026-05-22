/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `gpxMap` standalone style.
 *
 * Renders a Leaflet map preview of a GPX file referenced by the
 * section field map. The map tile hosts are declared in the
 * manifest's `security.cspRules.img-src` so the host's response CSP
 * allows OpenStreetMap / Carto tiles.
 *
 * Leaflet itself ships as a peer-of-a-peer-of-a-peer of the SurveyJS
 * runtime; we resolve it via dynamic import so a page without a
 * `gpxMap` section pays nothing.
 */

import { useEffect, useRef } from 'react';

export interface IGpxMapStyleProps {
    section: {
        id: number;
        fields?: Record<string, unknown>;
        style_name?: string;
    };
    values?: Record<string, unknown>;
}

export function GpxMapStyle({ section }: IGpxMapStyleProps): React.ReactElement {
    const gpxUrl = extractGpxUrl(section);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!gpxUrl) return undefined;
        let activeMap: { remove: () => void; fitBounds: (bounds: unknown) => unknown } | null = null;
        let cancelled = false;

        const init = async (): Promise<void> => {
            const L = await import('leaflet').catch((err: Error) => {
                console.warn('[gpxMap] leaflet not available', err);
                return null;
            });
            if (!L || cancelled || !containerRef.current) return;
            const leaflet = (L as unknown as { default?: typeof L }).default ?? L;
            const map = leaflet.map(containerRef.current).setView([46.95, 7.45], 13) as unknown as {
                remove: () => void;
                fitBounds: (bounds: unknown) => unknown;
            };
            activeMap = map;
            leaflet
                .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '© OpenStreetMap contributors',
                })
                .addTo(map as never);
            try {
                const gpxText = await fetch(gpxUrl).then((r) => r.text());
                const points = parseGpx(gpxText);
                if (points.length > 0) {
                    const polyline = leaflet
                        .polyline(points, { color: '#228be6' })
                        .addTo(map as never);
                    map.fitBounds(polyline.getBounds());
                }
            } catch (err) {
                console.warn('[gpxMap] failed to load GPX', err);
            }
        };
        void init();

        return () => {
            cancelled = true;
            if (activeMap) activeMap.remove();
        };
    }, [gpxUrl]);

    if (!gpxUrl) {
        return (
            <div role="alert" style={{ padding: 12, border: '1px solid #fab005', borderRadius: 4 }}>
                No GPX URL configured on this section.
            </div>
        );
    }

    return <div ref={containerRef} style={{ width: '100%', height: 400, borderRadius: 4 }} />;
}

function extractGpxUrl(section: IGpxMapStyleProps['section']): string | null {
    const fields = section.fields ?? {};
    for (const key of ['gpx_url', 'gpxUrl']) {
        const value = fields[key];
        if (typeof value === 'string' && value.trim() !== '') return value.trim();
        if (
            value &&
            typeof value === 'object' &&
            'content' in (value as Record<string, unknown>) &&
            typeof (value as { content?: unknown }).content === 'string'
        ) {
            return ((value as { content: string }).content ?? '').trim() || null;
        }
    }
    return null;
}

function parseGpx(xml: string): Array<[number, number]> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const points: Array<[number, number]> = [];
    const nodes = doc.getElementsByTagName('trkpt');
    for (let i = 0; i < nodes.length; i++) {
        const lat = Number(nodes[i]?.getAttribute('lat'));
        const lon = Number(nodes[i]?.getAttribute('lon'));
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            points.push([lat, lon]);
        }
    }
    return points;
}

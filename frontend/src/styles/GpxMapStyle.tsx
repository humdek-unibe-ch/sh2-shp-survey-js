/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `gpx-map` standalone style: draws a route on a Leaflet map from the
 * section's `sample_points` ({@link parseSamplePoints}): a list of points,
 * a whole GPX answer, or a variable resolving to either. The tile hosts are
 * declared in the manifest's `security.cspRules.img-src`.
 *
 * Leaflet is imported on demand, so a page without a `gpx-map` section pays
 * nothing.
 */

import { useEffect, useMemo, useRef } from 'react';
import { parseSamplePoints } from './samplePoints';

type TPluginStyleSection = {
    id: number;
    fields?: Record<string, unknown>;
    style_name?: string;
    [key: string]: unknown;
};

export interface IGpxMapStyleProps {
    style?: TPluginStyleSection;
    section?: TPluginStyleSection;
    values?: Record<string, unknown>;
    styleProps?: Record<string, string>;
    cssClass?: string;
}

export function GpxMapStyle({ style, section, styleProps, cssClass }: IGpxMapStyleProps): React.ReactElement {
    const runtimeSection = section ?? style;
    const rawPoints = fieldValue(runtimeSection, 'sample_points');
    const points = useMemo(() => parseSamplePoints(rawPoints), [rawPoints]);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (points.length === 0) return undefined;
        let activeMap: { remove: () => void; fitBounds: (bounds: unknown) => unknown } | null = null;
        let cancelled = false;

        const init = async (): Promise<void> => {
            const L = await import('leaflet').catch((err: Error) => {
                console.warn('[gpx-map] leaflet not available', err);
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
            const polyline = leaflet.polyline(points, { color: '#228be6' }).addTo(map as never);
            map.fitBounds(polyline.getBounds());
        };
        void init();

        return () => {
            cancelled = true;
            if (activeMap) activeMap.remove();
        };
    }, [points]);

    if (points.length === 0) {
        return (
            <div role="alert" style={{ padding: 12, border: '1px solid #fab005', borderRadius: 4 }}>
                No route to show: the section's sample points are empty or not readable.
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={cssClass}
            style={{ width: '100%', height: 400, borderRadius: 4 }}
            {...styleProps}
        />
    );
}

/** A section field's stored value (`{content}` or plain), or null. */
function fieldValue(section: TPluginStyleSection | undefined, key: string): unknown {
    const value = section?.fields?.[key] ?? section?.[key];
    if (value && typeof value === 'object' && 'content' in (value as Record<string, unknown>)) {
        return (value as { content?: unknown }).content ?? null;
    }
    return value ?? null;
}

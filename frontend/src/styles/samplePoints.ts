/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Reads the `sample_points` field of a `gpx-map` section into map points.
 * Accepted, as JSON text or already parsed (the core has filled in any
 * `{{variable}}` by then):
 *   - a list of points, each `{lat, lon}`, `{lat, lng}` or `[lat, lon]`;
 *   - a whole GPX answer of the survey's GPX question (`{sampledPoints: [...]}`).
 * Anything else, and points outside the valid range, are left out.
 */
export function parseSamplePoints(raw: unknown): Array<[number, number]> {
    let value = raw;
    if (typeof value === 'string') {
        const text = value.trim();
        if (text === '') return [];
        try {
            value = JSON.parse(text) as unknown;
        } catch {
            return [];
        }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = (value as { sampledPoints?: unknown }).sampledPoints;
    }
    if (!Array.isArray(value)) return [];

    const points: Array<[number, number]> = [];
    for (const item of value) {
        const point = toPoint(item);
        if (point) points.push(point);
    }
    return points;
}

function toPoint(item: unknown): [number, number] | null {
    let lat: unknown;
    let lon: unknown;
    if (Array.isArray(item)) {
        [lat, lon] = item as unknown[];
    } else if (item && typeof item === 'object') {
        const p = item as { lat?: unknown; lon?: unknown; lng?: unknown };
        lat = p.lat;
        lon = p.lon ?? p.lng;
    }
    const la = Number(lat);
    const lo = Number(lon);
    if (lat === null || lon === null || lat === undefined || lon === undefined || !Number.isFinite(la) || !Number.isFinite(lo)) {
        return null;
    }
    return Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? [la, lo] : null;
}

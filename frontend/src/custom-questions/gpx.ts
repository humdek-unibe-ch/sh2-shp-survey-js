/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * GPX track custom question type.
 *
 * Ports `7_gpxQuestionWidget.js`:
 *   - file picker accepting `.gpx`,
 *   - parses the GPX in the browser,
 *   - computes evenly-sampled points + total distance,
 *   - renders a Leaflet preview,
 *   - uploads the original file via the plugin file pipeline so the
 *     answer JSON carries `{ url, sampledPoints, distanceMeters }`.
 */

import type { ComponentCollection as ComponentCollectionType, Serializer as SerializerType } from 'survey-core';

interface IRegisterArgs {
    componentCollection: typeof ComponentCollectionType;
    serializer: typeof SerializerType;
}

export function registerGpxQuestion({ componentCollection, serializer }: IRegisterArgs): void {
    addProperty(serializer, 'gpx', { name: 'maxSampledPoints:number', default: 100, category: 'general' });
    componentCollection.Instance.add({
        name: 'gpx',
        title: 'GPX track',
        iconName: 'icon-gpx',
        questionJSON: {
            type: 'file',
            acceptedTypes: '.gpx,application/gpx+xml,application/xml',
            storeDataAsText: false,
            allowMultiple: false,
            maxSize: 25 * 1024 * 1024,
        },
        onLoaded(question) {
            const target = question as { setPropertyValue: (name: string, value: unknown) => void };
            target.setPropertyValue('renderAs', 'sh2-gpx-question');
        },
    });
}

function addProperty(serializer: typeof SerializerType, className: string, descriptor: Record<string, unknown>): void {
    const existing = serializer.getProperty(className, String(descriptor.name).split(':')[0] ?? '');
    if (existing) return;
    serializer.addProperty(className, descriptor);
}

export interface IGpxTrack {
    sampledPoints: Array<{ lat: number; lon: number; ele?: number }>;
    distanceMeters: number;
    pointCount: number;
}

export function parseGpxText(text: string, maxSamples = 100): IGpxTrack {
    if (typeof DOMParser === 'undefined') {
        return { sampledPoints: [], distanceMeters: 0, pointCount: 0 };
    }
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
    if (trkpts.length === 0) {
        return { sampledPoints: [], distanceMeters: 0, pointCount: 0 };
    }
    const allPoints = trkpts.map((node) => ({
        lat: Number.parseFloat(node.getAttribute('lat') ?? 'NaN'),
        lon: Number.parseFloat(node.getAttribute('lon') ?? 'NaN'),
        ele: Number.parseFloat(node.getElementsByTagName('ele')[0]?.textContent ?? 'NaN'),
    })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

    const sampledPoints = downsample(allPoints, maxSamples);
    let distanceMeters = 0;
    for (let i = 1; i < allPoints.length; i++) {
        const a = allPoints[i - 1];
        const b = allPoints[i];
        if (a && b) {
            distanceMeters += haversine(a, b);
        }
    }
    return { sampledPoints, distanceMeters, pointCount: allPoints.length };
}

function downsample<T>(values: T[], target: number): T[] {
    if (values.length <= target) return values.slice();
    const step = (values.length - 1) / (target - 1);
    const out: T[] = [];
    for (let i = 0; i < target; i++) {
        const idx = Math.round(i * step);
        const v = values[idx];
        if (v !== undefined) {
            out.push(v);
        }
    }
    return out;
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R = 6371000; // Earth radius in metres.
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
    return deg * (Math.PI / 180);
}

export async function mountGpxQuestion(
    container: HTMLElement,
    question: {
        name: string;
        value: unknown;
        readOnly: boolean;
        getPropertyValue: (name: string) => unknown;
    },
    args: {
        uploadFile: (questionName: string, file: File) => Promise<{ id: number; downloadUrl: string; filename: string }>;
        setAnswer: (value: unknown) => void;
    },
): Promise<void> {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'sh2-gpx-question';
    container.appendChild(wrap);

    const mapEl = document.createElement('div');
    mapEl.className = 'sh2-gpx-question__map';
    mapEl.style.minHeight = '320px';
    mapEl.style.height = '320px';

    const meta = document.createElement('div');
    meta.className = 'sh2-gpx-question__meta';

    if (!question.readOnly) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.gpx,application/gpx+xml,application/xml';
        wrap.appendChild(input);
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const track = parseGpxText(text, Number(question.getPropertyValue('maxSampledPoints') ?? 100));
                const uploaded = await args.uploadFile(question.name, file);
                args.setAnswer({
                    url: uploaded.downloadUrl,
                    fileId: uploaded.id,
                    filename: uploaded.filename,
                    sampledPoints: track.sampledPoints,
                    distanceMeters: track.distanceMeters,
                    pointCount: track.pointCount,
                });
                renderMap(mapEl, track);
                renderMeta(meta, track);
            } catch (err) {
                meta.textContent = `Failed to parse GPX: ${(err as Error).message}`;
            }
        });
    }

    wrap.appendChild(mapEl);
    wrap.appendChild(meta);

    const initial = question.value as
        | { sampledPoints?: Array<{ lat: number; lon: number }>; distanceMeters?: number }
        | null
        | undefined;
    if (initial?.sampledPoints?.length) {
        const track: IGpxTrack = {
            sampledPoints: initial.sampledPoints.map((p) => ({ lat: p.lat, lon: p.lon })),
            distanceMeters: Number(initial.distanceMeters ?? 0),
            pointCount: initial.sampledPoints.length,
        };
        renderMap(mapEl, track);
        renderMeta(meta, track);
    }
}

async function renderMap(mapEl: HTMLElement, track: IGpxTrack): Promise<void> {
    if (typeof window === 'undefined' || track.sampledPoints.length === 0) return;
    const first = track.sampledPoints[0];
    if (!first) return;
    try {
        const leaflet = (await import('leaflet')) as unknown as {
            map: (el: HTMLElement) => { setView: (latlng: [number, number], zoom: number) => unknown; fitBounds: (bounds: unknown) => unknown; remove: () => void };
            tileLayer: (url: string, opts?: Record<string, unknown>) => { addTo: (m: unknown) => unknown };
            polyline: (points: Array<[number, number]>, opts?: Record<string, unknown>) => {
                addTo: (m: unknown) => { getBounds: () => unknown };
            };
        };
        const map = leaflet.map(mapEl);
        map.setView([first.lat, first.lon], 13);
        leaflet
            .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap',
            })
            .addTo(map);
        const line = leaflet
            .polyline(
                track.sampledPoints.map((p) => [p.lat, p.lon] as [number, number]),
                { color: '#1976d2', weight: 3 },
            )
            .addTo(map);
        map.fitBounds(line.getBounds());
    } catch {
        mapEl.textContent = 'Leaflet map unavailable.';
    }
}

function renderMeta(el: HTMLElement, track: IGpxTrack): void {
    const km = track.distanceMeters >= 1000
        ? `${(track.distanceMeters / 1000).toFixed(2)} km`
        : `${Math.round(track.distanceMeters)} m`;
    el.innerHTML = `<small>${track.pointCount} GPS points · sampled ${track.sampledPoints.length} · ${km}</small>`;
}

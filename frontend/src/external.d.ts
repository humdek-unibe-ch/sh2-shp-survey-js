/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Minimal ambient declarations for the optional peer modules we lazy-load.
 * The real types come from the consumer's lockfile when the plugin is
 * installed; this file lets `tsc --noEmit` in the plugin repo pass
 * without forcing leaflet/survey-* to be runtime dependencies.
 */

declare module 'leaflet' {
    export interface ILatLngBounds {
        getBounds(): unknown;
    }
    export interface IPolyline extends ILatLngBounds {
        addTo(map: IMap): IPolyline;
    }
    export interface ITileLayer {
        addTo(map: IMap): ITileLayer;
    }
    export interface IMap {
        setView(latlng: [number, number], zoom: number): IMap;
        fitBounds(bounds: unknown): IMap;
        remove(): void;
    }
    export function map(element: HTMLElement): IMap;
    export function tileLayer(
        urlTemplate: string,
        options?: Record<string, unknown>,
    ): ITileLayer;
    export function polyline(
        points: Array<[number, number]>,
        options?: Record<string, unknown>,
    ): IPolyline;
    const _default: {
        map: typeof map;
        tileLayer: typeof tileLayer;
        polyline: typeof polyline;
    };
    export default _default;
}

declare module 'survey-core' {
    export class Model {
        constructor(definition: unknown);
        applyTheme(theme: Record<string, unknown>): void;
        onComplete: { add: (cb: (sender: { data: Record<string, unknown> }) => void) => void };
    }
    export const ComponentCollection: {
        Instance: {
            add: (descriptor: { name: string; title: string; questionJSON: Record<string, unknown> }) => void;
        };
    };
}

declare module 'survey-react-ui' {
    export const Survey: React.ComponentType<{ model: unknown }>;
}

declare module 'survey-creator-react' {
    export class SurveyCreator {
        constructor(options: Record<string, unknown>);
        JSON: Record<string, unknown>;
        applyTheme(theme: Record<string, unknown>): void;
        saveSurveyFunc: (id: unknown, success: (saved: boolean) => void) => void;
    }
    export const SurveyCreatorComponent: React.ComponentType<{ creator: unknown }>;
}

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
    export interface IEvent<TArgs = unknown> {
        add: (cb: (sender: ISurveyModel, args: TArgs) => void) => void;
        remove: (cb: (sender: ISurveyModel, args: TArgs) => void) => void;
    }
    export interface ISurveyModel {
        data: Record<string, unknown>;
        currentPageNo: number;
        getAllQuestions: () => Array<{ name: string; getType: () => string; value: unknown; readOnly: boolean }>;
        applyTheme(theme: Record<string, unknown>): void;
        setVariable(name: string, value: unknown): void;
        getVariable(name: string): unknown;
        completedHtml: string;
        showCompletedPage: boolean;
        addNavigationItem: (item: { id: string; title: string; action: () => void; visible?: boolean }) => void;
        completeLastPage: () => boolean;
        doComplete: () => void;
        navigateToUrl: string | null;
        locale: string;
        mergeData: (data: Record<string, unknown>) => void;
        clear: (clearData?: boolean, gotoFirstPage?: boolean) => void;
        getPropertyValue: (name: string) => unknown;
        setPropertyValue: (name: string, value: unknown) => void;
        onComplete: IEvent<{ data: Record<string, unknown> }>;
        onCurrentPageChanged: IEvent<{ oldCurrentPage: { name: string }; newCurrentPage: { name: string }; isNextPage: boolean }>;
        onValueChanged: IEvent<{ name: string; value: unknown }>;
        onAfterRenderQuestion: IEvent<{ question: unknown; htmlElement: HTMLElement }>;
        onUploadFiles: IEvent<{ name: string; files: File[]; callback: (status: string, value?: Array<{ file: File; content: string }>) => void; question: unknown }>;
        onDownloadFile: IEvent<{ content: unknown; callback: (status: string, value?: string) => void }>;
        onClearFiles: IEvent<{ value: unknown; callback: (status: string) => void }>;
    }
    export class Model implements ISurveyModel {
        constructor(definition: unknown);
        data: Record<string, unknown>;
        currentPageNo: number;
        completedHtml: string;
        showCompletedPage: boolean;
        navigateToUrl: string | null;
        locale: string;
        getAllQuestions: () => Array<{ name: string; getType: () => string; value: unknown; readOnly: boolean }>;
        applyTheme(theme: Record<string, unknown>): void;
        setVariable(name: string, value: unknown): void;
        getVariable(name: string): unknown;
        addNavigationItem(item: { id: string; title: string; action: () => void; visible?: boolean }): void;
        completeLastPage(): boolean;
        doComplete(): void;
        mergeData(data: Record<string, unknown>): void;
        clear(clearData?: boolean, gotoFirstPage?: boolean): void;
        getPropertyValue(name: string): unknown;
        setPropertyValue(name: string, value: unknown): void;
        onComplete: IEvent<{ data: Record<string, unknown> }>;
        onCurrentPageChanged: IEvent<{ oldCurrentPage: { name: string }; newCurrentPage: { name: string }; isNextPage: boolean }>;
        onValueChanged: IEvent<{ name: string; value: unknown }>;
        onAfterRenderQuestion: IEvent<{ question: unknown; htmlElement: HTMLElement }>;
        onUploadFiles: IEvent<{ name: string; files: File[]; callback: (status: string, value?: Array<{ file: File; content: string }>) => void; question: unknown }>;
        onDownloadFile: IEvent<{ content: unknown; callback: (status: string, value?: string) => void }>;
        onClearFiles: IEvent<{ value: unknown; callback: (status: string) => void }>;
    }
    export const ComponentCollection: {
        Instance: {
            add: (descriptor: {
                name: string;
                title: string;
                iconName?: string;
                questionJSON: Record<string, unknown>;
                onLoaded?: (question: unknown) => void;
                onItemValuePropertyChanged?: (q: unknown, options: unknown) => void;
            }) => void;
        };
    };
    export const Serializer: {
        addProperty: (className: string, descriptor: Record<string, unknown>) => void;
        getProperty: (className: string, name: string) => unknown;
        removeProperty: (className: string, name: string) => void;
    };
    export const surveyLocalization: {
        defaultLocale: string;
        currentLocale: string;
        locales: Record<string, Record<string, string>>;
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

// Optional commercial / heavy modules. Declared as `any` so the
// runtime + dashboard pages can dynamically import them with full
// TypeScript narrowing on the consumer side, but `tsc --noEmit` in
// the plugin repo does not require the matching `@types/` to be
// installed when the operator hasn't opted into the feature.
declare module 'tabulator-tables' {
    export const Tabulator: new (element: HTMLElement, options: Record<string, unknown>) => {
        destroy: () => void;
        replaceData: (data: Array<Record<string, unknown>>) => Promise<unknown>;
        download: (format: string, filename: string, options?: Record<string, unknown>) => void;
        setColumns: (columns: Array<Record<string, unknown>>) => void;
    };
}

declare module 'survey-analytics' {
    export const VisualizationPanel: new (
        questions: Array<unknown>,
        data: Array<Record<string, unknown>>,
        options?: Record<string, unknown>,
    ) => {
        render: (element: HTMLElement) => void;
        destroy: () => void;
    };
}

declare module 'survey-pdf' {
    export class SurveyPDF {
        constructor(definition: unknown, options: unknown);
        data: Record<string, unknown>;
        save(filename: string): void;
    }
}

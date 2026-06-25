/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * `surveyjs` mobile style — native host shell.
 *
 * Hosts the OFFICIAL SurveyJS web runtime (`survey-core` + `survey-react-ui`)
 * inside an isolated, self-contained WebView (react-native-webview on native,
 * an iframe on the Expo web export) and drives it with the typed postMessage
 * bridge. This shell:
 *   - owns ALL authenticated backend access via `@selfhelp/shared`
 *     `MobileHostServices` (token + 401-refresh + session-expiry live in the
 *     host; the WebView never sees the token);
 *   - answers the runtime's intents (`LOAD_SURVEY` / `SAVE_PROGRESS` /
 *     `SUBMIT_SURVEY`) by calling `/published`, `/progress`, `/submit` and
 *     returning the result (`SURVEY_LOADED` / `PROGRESS_SAVED` /
 *     `SUBMIT_RESULT` / `SESSION_EXPIRED`);
 *   - sizes the WebView from `RESIZE`, handles `REQUEST_REDIRECT`, and renders
 *     the loading / error / retry / session-expired chrome around it.
 *
 * The survey UI (questions, validation, completion) is owned entirely by
 * SurveyJS inside the WebView. This shell only renders the outer chrome.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';

import { getMobileHostServices } from '@selfhelp/shared/plugin-sdk';
import type { IMobileHostServices } from '@selfhelp/shared/plugin-sdk';

import {
    SurveyHostError,
    fetchDraft,
    loadPublishedSurvey,
    saveProgress,
    submitSurvey,
} from '../api/surveys';
import {
    BRIDGE_SOURCE,
    isWebviewToHostMessage,
    type THostToWebviewMessage,
    type TWebviewToHostMessage,
} from '../bridge/messages';
import { SURVEYJS_WEBVIEW_HTML } from '../webview/htmlAsset';
import type { IWebViewTransportProps } from './transport/contract';
import {
    buildRuntimeConfigFromSection,
    configToServerConfig,
    extractSurveyId,
    type ISectionLike,
} from './section';

export interface ISurveyJsStyleProps {
    section: ISectionLike;
    values?: Record<string, unknown>;
}

type TShellState =
    | { kind: 'running' }
    | { kind: 'session-expired' }
    | { kind: 'error'; message: string };

/**
 * URLs the WebView itself may load — everything else is blocked. This is the
 * navigation guard wired into the native transport's
 * `onShouldStartLoadWithRequest`, so it is the enforcement point for "no
 * arbitrary navigation / block unknown external URLs". Only the self-contained
 * runtime document load is allowed (`source={{ html }}` resolves to
 * `about:blank` on native, `about:srcdoc` in the web-export iframe; `data:` is
 * permitted for inline assets the runtime may reference). Real redirects never
 * happen via WebView navigation — the runtime emits `REQUEST_REDIRECT` and the
 * native host performs the navigation. Exported for the WebView security tests.
 */
export function isAllowedWebViewUrl(url: string): boolean {
    return url === '' || url === 'about:blank' || url.startsWith('data:') || url.startsWith('about:srcdoc');
}

/** How a survey's in-content redirect (`REQUEST_REDIRECT`) is performed. */
export type TRedirectAction =
    | { kind: 'host'; target: string; external: boolean }
    | { kind: 'external'; target: string }
    | { kind: 'web-assign'; target: string }
    | { kind: 'unsupported'; target: string };

/**
 * Decide how to honour a survey redirect. Pure + exported so the routing is
 * unit-tested without rendering the WebView shell.
 *
 * Priority is host-owned navigation (renderer >= 0.3.0): the host owns the
 * router, so it routes an internal CMS target through the app's navigation stack
 * and leaves the app only for an explicit external URL — correct in BOTH the
 * native app and the web-export live preview, where the plugin doing its own
 * `location.assign` would navigate (and break) the embedded preview iframe
 * instead of the app. Feature-detected, so on a host that predates `navigate` we
 * degrade: external URLs still open, web falls back to a same-window assign
 * (the legacy "weird preview redirect"), and an internal target on a native
 * legacy host is unsupported (the completion screen stays visible).
 */
export function chooseRedirectAction(
    hasHostNavigate: boolean,
    isWeb: boolean,
    target: string,
    external: boolean,
): TRedirectAction {
    if (hasHostNavigate) return { kind: 'host', target, external };
    if (external) return { kind: 'external', target };
    if (isWeb) return { kind: 'web-assign', target };
    return { kind: 'unsupported', target };
}

function loadTransport(): React.ComponentType<IWebViewTransportProps> {
    // Lazy-require the matching transport so the native module
    // (react-native-webview) is never evaluated on web, and the DOM iframe is
    // never evaluated on native. `require` is provided by the RN runtime.
    if (Platform.OS === 'web') {
        return (require('./transport/SurveyWebViewWeb') as {
            SurveyWebViewWeb: React.ComponentType<IWebViewTransportProps>;
        }).SurveyWebViewWeb;
    }
    return (require('./transport/SurveyWebViewNative') as {
        SurveyWebViewNative: React.ComponentType<IWebViewTransportProps>;
    }).SurveyWebViewNative;
}

function extractDraftData(payload: Record<string, unknown>): Record<string, unknown> {
    const data = payload.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
    }
    return {};
}

export function SurveyJsStyle({ section }: ISurveyJsStyleProps): React.ReactElement | null {
    const surveyKey = useMemo(() => extractSurveyId(section), [section]);
    const config = useMemo(() => buildRuntimeConfigFromSection(section), [section]);
    const host = useMemo<IMobileHostServices | null>(() => getMobileHostServices(), []);

    const [state, setState] = useState<TShellState>({ kind: 'running' });
    const [height, setHeight] = useState<number>(320);
    const [reloadKey, setReloadKey] = useState<number>(0);

    const postRef = useRef<((json: string) => void) | null>(null);

    const post = useCallback((message: THostToWebviewMessage): void => {
        postRef.current?.(JSON.stringify(message));
    }, []);

    const handleRedirect = useCallback((target: string, external: boolean): void => {
        const action = chooseRedirectAction(
            host !== null && typeof host.navigate === 'function',
            Platform.OS === 'web',
            target,
            external,
        );
        switch (action.kind) {
            case 'host':
                // Preferred path (renderer >= 0.3.0): the host owns the router, so
                // it routes an internal CMS target through the app's navigation
                // stack and leaves the app only for an explicit external URL —
                // correct in BOTH the native app and the web-export live preview.
                if (host && host.navigate) host.navigate(action.target, action.external);
                return;
            case 'external':
                void Linking.openURL(action.target);
                return;
            case 'web-assign': {
                // Legacy fallback on web when the host predates `navigate`: a raw
                // same-window assign. In the live preview this navigates the
                // embedded iframe (the "weird redirect"); only reached on a host
                // older than renderer 0.3.0.
                const location = (globalThis as { location?: { assign?: (t: string) => void } }).location;
                if (location && typeof location.assign === 'function') location.assign(action.target);
                return;
            }
            case 'unsupported':
                // Internal CMS-keyword navigation on native needs the host router,
                // which a host older than renderer 0.3.0 did not expose.
                console.warn(
                    `[surveyjs] internal redirect "${action.target}" is not supported on this host; staying on completion.`,
                );
                return;
        }
    }, [host]);

    const onIntent = useCallback(
        async (message: TWebviewToHostMessage): Promise<void> => {
            if (!host || !surveyKey) return;
            switch (message.type) {
                case 'READY':
                    post({ source: BRIDGE_SOURCE, type: 'INIT', surveyKey, config, theme: null, locale: null });
                    return;
                case 'LOAD_SURVEY':
                    try {
                        const published = await loadPublishedSurvey(
                            host,
                            surveyKey,
                            configToServerConfig(config),
                            {},
                        );
                        let draft: { responseId: string; pageNo: number; data: Record<string, unknown> } | null =
                            null;
                        if (!config.restartOnRefresh && !published.state.lockoutReason) {
                            try {
                                const d = await fetchDraft(host, surveyKey, published.state.draft?.responseId);
                                if (d) {
                                    draft = {
                                        responseId: d.responseId,
                                        pageNo: d.pageNo,
                                        data: extractDraftData(d.payload),
                                    };
                                }
                            } catch {
                                /* draft is best-effort; fall through with none */
                            }
                        }
                        post({
                            source: BRIDGE_SOURCE,
                            type: 'SURVEY_LOADED',
                            definition: published.definition,
                            tokens: published.tokens,
                            extraParams: published.extraParams,
                            runtimeConfig: published.runtimeConfig,
                            state: published.state,
                            draft,
                        });
                    } catch (err) {
                        handleHostError(err);
                    }
                    return;
                case 'SAVE_PROGRESS':
                    try {
                        const saved = await saveProgress(host, surveyKey, {
                            responseId: message.responseId,
                            pageNo: message.pageNo,
                            payload: { data: message.data, triggerType: 'updated', locale: message.locale ?? null },
                        });
                        post({ source: BRIDGE_SOURCE, type: 'PROGRESS_SAVED', ok: true, responseId: saved.responseId });
                    } catch (err) {
                        if (err instanceof SurveyHostError && err.sessionExpired) {
                            post({ source: BRIDGE_SOURCE, type: 'SESSION_EXPIRED' });
                            setState({ kind: 'session-expired' });
                            return;
                        }
                        post({ source: BRIDGE_SOURCE, type: 'PROGRESS_SAVED', ok: false });
                    }
                    return;
                case 'SUBMIT_SURVEY':
                    try {
                        const result = await submitSurvey(host, surveyKey, message.data, message.enforce);
                        post({
                            source: BRIDGE_SOURCE,
                            type: 'SUBMIT_RESULT',
                            ok: true,
                            responseId: result.responseId,
                            submittedAt: result.submittedAt,
                        });
                    } catch (err) {
                        if (err instanceof SurveyHostError && err.sessionExpired) {
                            post({ source: BRIDGE_SOURCE, type: 'SESSION_EXPIRED' });
                            setState({ kind: 'session-expired' });
                            return;
                        }
                        const reason = err instanceof SurveyHostError ? err.reason : undefined;
                        post({
                            source: BRIDGE_SOURCE,
                            type: 'SUBMIT_RESULT',
                            ok: false,
                            reason,
                            message: err instanceof Error ? err.message : 'Submission failed.',
                        });
                    }
                    return;
                case 'RESIZE':
                    if (message.height > 0) setHeight(Math.ceil(message.height));
                    return;
                case 'REQUEST_REDIRECT':
                    handleRedirect(message.target, message.external);
                    return;
                case 'RUNTIME_ERROR':
                    setState({ kind: 'error', message: message.message });
                    return;
                case 'UNSUPPORTED':
                    console.warn(`[surveyjs] unsupported feature in WebView runtime: ${message.feature}`);
                    return;
                default:
                    return;
            }

            function handleHostError(err: unknown): void {
                if (err instanceof SurveyHostError && err.sessionExpired) {
                    setState({ kind: 'session-expired' });
                    return;
                }
                setState({
                    kind: 'error',
                    message: err instanceof Error ? `Survey not available: ${err.message}` : 'Survey not available.',
                });
            }
        },
        [host, surveyKey, config, post, handleRedirect],
    );

    const onMessage = useCallback(
        (raw: unknown): void => {
            let parsed: unknown = raw;
            if (typeof raw === 'string') {
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    return;
                }
            }
            if (isWebviewToHostMessage(parsed)) {
                void onIntent(parsed);
            }
        },
        [onIntent],
    );

    const setPost = useCallback((fn: (json: string) => void): void => {
        postRef.current = fn;
    }, []);

    const retry = useCallback((): void => {
        setState({ kind: 'running' });
        setHeight(320);
        setReloadKey((key) => key + 1);
    }, []);

    if (!surveyKey) {
        return (
            <Notice tone="warning" text="The SurveyJS section is missing a selected survey." />
        );
    }
    if (!host) {
        return (
            <Notice
                tone="warning"
                text="SurveyJS needs a newer SelfHelp mobile app. Please update the app to take this survey."
            />
        );
    }
    if (state.kind === 'session-expired') {
        return (
            <Notice tone="neutral" text="Your session has expired. Please sign in again to continue." />
        );
    }
    if (state.kind === 'error') {
        return (
            <View style={{ padding: 12, borderWidth: 1, borderColor: '#fa5252', borderRadius: 6, gap: 8 }}>
                <Text style={{ color: '#c92a2a' }}>{state.message}</Text>
                <Pressable
                    onPress={retry}
                    accessibilityRole="button"
                    style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#e9ecef', borderRadius: 6 }}
                >
                    <Text style={{ color: '#212529', fontWeight: '600' }}>Retry</Text>
                </Pressable>
            </View>
        );
    }

    const Transport = loadTransport();
    return (
        <View style={{ paddingVertical: 8 }}>
            <Transport
                key={reloadKey}
                html={SURVEYJS_WEBVIEW_HTML}
                height={height}
                onMessage={onMessage}
                setPost={setPost}
                isAllowedUrl={isAllowedWebViewUrl}
            />
        </View>
    );
}

function Notice({ tone, text }: { tone: 'warning' | 'neutral'; text: string }): React.ReactElement {
    const palette =
        tone === 'warning'
            ? { border: '#fab005', color: '#856404' }
            : { border: '#dee2e6', color: '#495057' };
    return (
        <View style={{ padding: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 6 }}>
            <Text style={{ color: palette.color }}>{text}</Text>
        </View>
    );
}

/** Re-exported so the host can show a spinner consistently if it wants. */
export function SurveyJsLoading(): React.ReactElement {
    return (
        <View style={{ paddingVertical: 16, alignItems: 'center' }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 8, color: '#495057' }}>Loading survey…</Text>
        </View>
    );
}

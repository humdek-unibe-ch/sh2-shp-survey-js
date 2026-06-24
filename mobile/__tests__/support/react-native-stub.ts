/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Minimal `react-native` stub for the mobile parity/contract tests.
 *
 * The tests inspect the *registration object* returned by `registerMobile()`
 * and the pure bridge/controller helpers; they never render the WebView shell.
 * Importing the real `react-native` under Node/Vitest pulls in the native
 * runtime and fails, so `mobile/vitest.config.ts` aliases `react-native` to
 * this file. It exports only the symbols `SurveyJsStyle.tsx` references at
 * module-eval time (`ActivityIndicator`, `Linking`, `Platform`, `Pressable`,
 * `Text`, `View`) so the import resolves cleanly.
 *
 * Full react-native rendering (RTL/jest-preset) arrives with the broader
 * mobile harness; this stub is intentionally inert.
 */

const NoopComponent = (): null => null;

export const Text = NoopComponent;
export const View = NoopComponent;
export const Pressable = NoopComponent;
export const ActivityIndicator = NoopComponent;
export const Linking = {
    openURL: (): Promise<void> => Promise.resolve(),
};
export const Platform = {
    OS: 'web' as const,
    select: <T,>(options: { web?: T; native?: T; default?: T }): T | undefined =>
        options.web ?? options.default,
};

export default { Text, View, Pressable, ActivityIndicator, Linking, Platform };

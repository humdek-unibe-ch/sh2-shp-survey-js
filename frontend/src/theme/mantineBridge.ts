/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Maps the host's **live Mantine theme** (read via `useMantineTheme()`
 * + `useMantineColorScheme()`) to the two CSS-variable surfaces
 * SurveyJS v2 exposes:
 *
 *   - `--sjs-*` — consumed by `survey-core` to style the **runtime
 *     form** (the rendered survey users fill in). Emitted by
 *     {@link buildSurveyJsTheme}, applied via `model.applyTheme(...)`.
 *
 *   - `--ctr-*` — consumed by `survey-creator-core` to style the
 *     **Creator chrome** (toolbox, property grid, top bar, page tabs,
 *     drag handles). Emitted by {@link buildCreatorTheme}, applied
 *     via `creator.applyCreatorTheme(...)` on mount.
 *
 * The `default` survey theme code derives its palette from the live
 * Mantine theme through {@link useMantineLivePalette} so that a host
 * customizing `theme.primaryColor` or switching to dark mode is
 * reflected in both the runtime form and the Designer chrome
 * without rebuilding the plugin.
 *
 * The `modern` and `high-contrast` codes remain *editorial overrides*:
 * the author explicitly picked a specific look on the survey, so the
 * static palette wins over the host theme.
 *
 * Why `--ctr-*` is mandatory: the Creator only ships four built-in
 * themes (Light, Dark, Contrast, Survey Creator 2020). Without a
 * `--ctr-*` override the Designer renders in SurveyJS-default colours
 * — generic blue buttons, generic 4 px corner radius, system font.
 * Mapping the Mantine palette into `--ctr-*` is the supported public
 * theming surface, so this stays compatible across SurveyJS minor
 * updates within the 2.5.x line.
 */

import { useMemo } from 'react';
import { useComputedColorScheme, useMantineTheme } from '@mantine/core';
import { DefaultDark as SurveyCreatorDefaultDark, DefaultLight as SurveyCreatorDefaultLight } from 'survey-creator-core/themes';

interface IThemePalette {
    background: string;
    surface: string;
    text: string;
    primary: string;
    primaryText: string;
    border: string;
    mode: 'light' | 'dark';
    /** Subtle hover/selection surface — used for toolbox row hovers. */
    surfaceMuted: string;
    /** Fills used for active/selected accents (lighter than primary). */
    primarySoft: string;
}

const HOST_PALETTE_LIGHT: IThemePalette = {
    mode: 'light',
    background: '#f8f9fa',
    surface: '#ffffff',
    text: '#212529',
    primary: '#228be6',
    primaryText: '#ffffff',
    border: '#dee2e6',
    surfaceMuted: '#f1f3f5',
    primarySoft: '#d0ebff',
};

const HOST_PALETTE_HIGH_CONTRAST: IThemePalette = {
    mode: 'dark',
    background: '#000000',
    surface: '#111111',
    text: '#ffffff',
    primary: '#ffd43b',
    primaryText: '#000000',
    border: '#ffffff',
    surfaceMuted: '#1a1a1a',
    primarySoft: '#fff3bf',
};

const HOST_PALETTE_MODERN: IThemePalette = {
    mode: 'light',
    background: '#f1f3f5',
    surface: '#ffffff',
    text: '#1c2025',
    primary: '#7950f2',
    primaryText: '#ffffff',
    border: '#e9ecef',
    surfaceMuted: '#f8f9fa',
    primarySoft: '#e5dbff',
};

const STATIC_PALETTES: Record<string, IThemePalette> = {
    default: HOST_PALETTE_LIGHT,
    modern: HOST_PALETTE_MODERN,
    'high-contrast': HOST_PALETTE_HIGH_CONTRAST,
};

/**
 * React hook that reads the live Mantine theme + active color scheme
 * and projects them onto the SurveyJS palette shape. Must be called
 * inside a component tree wrapped in `MantineProvider` (the host shell
 * already does this for both runtime and admin trees).
 *
 * Returns `null` only as a defensive guard — Mantine throws if its
 * provider is missing, so consumers can safely treat the value as
 * non-null in normal operation.
 */
export function useMantineLivePalette(): IThemePalette {
    const theme = useMantineTheme();
    const colorScheme = useComputedColorScheme('light', {
        getInitialValueInEffect: true,
    });

    // Memoise so the reference is stable across renders that don't
    // actually change the palette. The Designer init effect depends
    // on this value; without memoisation it would re-run on every
    // host re-render and rebuild the Creator instance.
    return useMemo<IThemePalette>(() => {
        const isDark = colorScheme === 'dark';
        const primaryName = theme.primaryColor;
        const primaryScale = theme.colors[primaryName] ?? theme.colors.blue;
        const grayScale = theme.colors.gray;
        const darkScale = theme.colors.dark;

        return {
            mode: isDark ? 'dark' : 'light',
            primary: primaryScale[6],
            primaryText: theme.white,
            primarySoft: isDark ? primaryScale[8] : primaryScale[1],
            background: isDark ? darkScale[7] : theme.white,
            surface: isDark ? darkScale[6] : theme.white,
            surfaceMuted: isDark ? darkScale[5] : grayScale[0],
            text: isDark ? darkScale[0] : grayScale[9],
            border: isDark ? darkScale[4] : grayScale[3],
        };
    }, [colorScheme, theme]);
}

/**
 * Resolve the palette for a given survey `themeCode`. The live
 * Mantine palette (from {@link useMantineLivePalette}) is only used
 * for the `default` code — `modern` and `high-contrast` are explicit
 * editorial overrides chosen by the survey author.
 */
function resolvePalette(themeCode: string, livePalette: IThemePalette | null): IThemePalette {
    if (themeCode === 'default' && livePalette) {
        return livePalette;
    }
    return STATIC_PALETTES[themeCode] ?? livePalette ?? HOST_PALETTE_LIGHT;
}

/**
 * Build the SurveyJS runtime theme JSON. Applied to a `Model` via
 * `model.applyTheme(theme)`. Drives the form preview shown to the
 * end user as well as the preview tab inside the Creator.
 *
 * @param themeCode    The survey-level theme selector
 *                     (`default` | `modern` | `high-contrast`).
 * @param livePalette  The host's live Mantine palette derived from
 *                     {@link useMantineLivePalette}. Pass `null`
 *                     in non-React contexts (tests/build tools);
 *                     the static fallback palette will be used.
 */
export function buildSurveyJsTheme(
    themeCode: string,
    livePalette: IThemePalette | null = null,
): Record<string, unknown> {
    const palette = resolvePalette(themeCode, livePalette);
    return {
        cssVariables: {
            '--sjs-primary-backcolor': palette.primary,
            '--sjs-primary-backcolor-light': palette.primarySoft,
            '--sjs-primary-backcolor-dark': palette.primary,
            '--sjs-primary-forecolor': palette.primaryText,
            '--sjs-general-backcolor': palette.background,
            '--sjs-general-backcolor-dark': palette.surface,
            '--sjs-general-backcolor-dim': palette.surfaceMuted,
            '--sjs-general-backcolor-dim-light': palette.surface,
            '--sjs-general-forecolor': palette.text,
            '--sjs-general-forecolor-light': palette.text,
            '--sjs-border-default': palette.border,
            '--sjs-border-light': palette.border,
            '--sjs-corner-radius': '8px',
            '--sjs-base-unit': '8px',
            '--sjs-font-family':
                'var(--mantine-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
        },
        themeName: themeCode,
        isPanelless: false,
    };
}

/**
 * Build the Survey Creator chrome theme. Applied to a `SurveyCreator`
 * instance via `creator.applyCreatorTheme(theme)` on mount. Sits on
 * top of the Creator's "Light" base theme — only diffs are emitted
 * here so SurveyJS upstream defaults still cover any variable we
 * forget.
 *
 * Variable names are taken from the canonical Creator stylesheet
 * (see `survey-creator-core/src/main.scss`). They follow the pattern
 * `--ctr-<surface>-<role>-<state>`.
 */
export function buildCreatorTheme(
    themeCode: string,
    livePalette: IThemePalette | null = null,
): Record<string, unknown> {
    const palette = resolvePalette(themeCode, livePalette);
    if (themeCode === 'default' && palette.mode === 'dark') {
        return {
            ...SurveyCreatorDefaultDark,
            cssVariables: {
                ...SurveyCreatorDefaultDark.cssVariables,
                '--ctr-font-family':
                    'var(--mantine-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
            },
        };
    }
    if (themeCode === 'default' && palette.mode === 'light') {
        return {
            ...SurveyCreatorDefaultLight,
            cssVariables: {
                ...SurveyCreatorDefaultLight.cssVariables,
                '--ctr-font-family':
                    'var(--mantine-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
            },
        };
    }
    return {
        themeName: `mantine-${themeCode}`,
        cssVariables: {
            '--ctr-font-family':
                'var(--mantine-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',

            '--ctr-surface-background-color': palette.surface,
            '--ctr-surface-background-color-muted': palette.surfaceMuted,
            '--ctr-surface-background-color-dim': palette.background,
            '--ctr-foreground': palette.text,
            '--ctr-foreground-disabled': palette.border,

            '--ctr-border': palette.border,
            '--ctr-border-light': palette.border,
            '--ctr-corner-radius-medium': '8px',
            '--ctr-corner-radius-small': '6px',

            '--ctr-button-action-background-color-default': palette.primary,
            '--ctr-button-action-background-color-hovered': palette.primary,
            '--ctr-button-action-background-color-pressed': palette.primary,
            '--ctr-button-action-text-color-default': palette.primaryText,
            '--ctr-button-action-text-color-hovered': palette.primaryText,

            '--ctr-button-default-background-color-default': palette.surface,
            '--ctr-button-default-background-color-hovered': palette.surfaceMuted,
            '--ctr-button-default-text-color-default': palette.text,
            '--ctr-button-default-border-color-default': palette.border,

            '--ctr-toolbox-background-color': palette.surface,
            '--ctr-toolbox-tool-background-color-hovered': palette.surfaceMuted,
            '--ctr-toolbox-tool-background-color-selected': palette.primarySoft,
            '--ctr-toolbox-tool-text-color-default': palette.text,
            '--ctr-toolbox-tool-text-color-selected': palette.primary,

            '--ctr-property-grid-background-color': palette.surface,
            '--ctr-property-grid-header-background-color': palette.surfaceMuted,
            '--ctr-property-grid-foreground': palette.text,

            '--ctr-element-selected-border-color': palette.primary,
            '--ctr-element-selected-background-color': palette.primarySoft,

            '--ctr-tab-background-color': palette.surface,
            '--ctr-tab-background-color-hovered': palette.surfaceMuted,
            '--ctr-tab-foreground': palette.text,
            '--ctr-tab-foreground-selected': palette.primary,
            '--ctr-tab-indicator-background-color': palette.primary,
        },
    };
}

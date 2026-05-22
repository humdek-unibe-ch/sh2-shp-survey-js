/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Maps Mantine theme tokens (read from `@selfhelp/shared/theme`) to the
 * subset of CSS variables SurveyJS v2 recognises. The result is a
 * JSON object compatible with `SurveyModel.applyTheme()`.
 *
 * SurveyJS expects a flat record of CSS variables (`--sjs-primary-backcolor`,
 * etc.). We compose it from the host palette + a couple of plugin-only
 * overrides per declared `themeCode` (`default`, `modern`, `high-contrast`).
 *
 * No DOM-side work happens here; the bridge is pure data so the Creator
 * and the runtime read the same theme without round-tripping the host.
 */

interface IThemePalette {
    background: string;
    surface: string;
    text: string;
    primary: string;
    primaryText: string;
    border: string;
}

const HOST_PALETTE_LIGHT: IThemePalette = {
    background: '#f8f9fa',
    surface: '#ffffff',
    text: '#212529',
    primary: '#228be6',
    primaryText: '#ffffff',
    border: '#dee2e6',
};

const HOST_PALETTE_HIGH_CONTRAST: IThemePalette = {
    background: '#000000',
    surface: '#111111',
    text: '#ffffff',
    primary: '#ffd43b',
    primaryText: '#000000',
    border: '#ffffff',
};

const HOST_PALETTE_MODERN: IThemePalette = {
    background: '#f1f3f5',
    surface: '#ffffff',
    text: '#1c2025',
    primary: '#7950f2',
    primaryText: '#ffffff',
    border: '#e9ecef',
};

const PALETTES: Record<string, IThemePalette> = {
    default: HOST_PALETTE_LIGHT,
    modern: HOST_PALETTE_MODERN,
    'high-contrast': HOST_PALETTE_HIGH_CONTRAST,
};

export function buildSurveyJsTheme(themeCode: string): Record<string, unknown> {
    const palette = PALETTES[themeCode] ?? HOST_PALETTE_LIGHT;
    return {
        cssVariables: {
            '--sjs-primary-backcolor': palette.primary,
            '--sjs-primary-forecolor': palette.primaryText,
            '--sjs-general-backcolor': palette.background,
            '--sjs-general-backcolor-dark': palette.surface,
            '--sjs-general-forecolor': palette.text,
            '--sjs-border-default': palette.border,
            '--sjs-corner-radius': '6px',
            '--sjs-base-unit': '8px',
        },
        themeName: themeCode,
        isPanelless: false,
    };
}

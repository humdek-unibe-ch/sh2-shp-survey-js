/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Maps Mantine theme tokens (read from `@selfhelp/shared/theme`) to
 * the two CSS-variable surfaces SurveyJS v2 exposes:
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
 * Both builders are pure data so the Designer and the runtime share
 * the same Mantine palette without round-tripping through the host.
 *
 * Why `--ctr-*` is mandatory: the Creator only ships four built-in
 * themes (Light, Dark, Contrast, Survey Creator 2020). Without a
 * `--ctr-*` override the Designer renders in SurveyJS-default colours
 * — generic blue buttons, generic 4 px corner radius, system font.
 * Mapping the Mantine palette into `--ctr-*` is the supported public
 * theming surface, so this stays compatible across SurveyJS minor
 * updates within the 2.5.x line.
 */

interface IThemePalette {
    background: string;
    surface: string;
    text: string;
    primary: string;
    primaryText: string;
    border: string;
    /** Subtle hover/selection surface — used for toolbox row hovers. */
    surfaceMuted: string;
    /** Fills used for active/selected accents (lighter than primary). */
    primarySoft: string;
}

const HOST_PALETTE_LIGHT: IThemePalette = {
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
    background: '#f1f3f5',
    surface: '#ffffff',
    text: '#1c2025',
    primary: '#7950f2',
    primaryText: '#ffffff',
    border: '#e9ecef',
    surfaceMuted: '#f8f9fa',
    primarySoft: '#e5dbff',
};

const PALETTES: Record<string, IThemePalette> = {
    default: HOST_PALETTE_LIGHT,
    modern: HOST_PALETTE_MODERN,
    'high-contrast': HOST_PALETTE_HIGH_CONTRAST,
};

function resolvePalette(themeCode: string): IThemePalette {
    return PALETTES[themeCode] ?? HOST_PALETTE_LIGHT;
}

/**
 * Build the SurveyJS runtime theme JSON. Applied to a `Model` via
 * `model.applyTheme(theme)`. Drives the form preview shown to the
 * end user as well as the preview tab inside the Creator.
 */
export function buildSurveyJsTheme(themeCode: string): Record<string, unknown> {
    const palette = resolvePalette(themeCode);
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
export function buildCreatorTheme(themeCode: string): Record<string, unknown> {
    const palette = resolvePalette(themeCode);
    return {
        themeName: `mantine-${themeCode}`,
        cssVariables: {
            // Typography
            '--ctr-font-family':
                'var(--mantine-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',

            // Surfaces — top bar, designer canvas, side panels.
            '--ctr-surface-background-color': palette.surface,
            '--ctr-surface-background-color-muted': palette.surfaceMuted,
            '--ctr-surface-background-color-dim': palette.background,
            '--ctr-foreground': palette.text,
            '--ctr-foreground-disabled': palette.border,

            // Borders and dividers
            '--ctr-border': palette.border,
            '--ctr-border-light': palette.border,
            '--ctr-corner-radius-medium': '8px',
            '--ctr-corner-radius-small': '6px',

            // Primary action button — "Save", "Publish", confirm dialogs.
            '--ctr-button-action-background-color-default': palette.primary,
            '--ctr-button-action-background-color-hovered': palette.primary,
            '--ctr-button-action-background-color-pressed': palette.primary,
            '--ctr-button-action-text-color-default': palette.primaryText,
            '--ctr-button-action-text-color-hovered': palette.primaryText,

            // Default/secondary buttons
            '--ctr-button-default-background-color-default': palette.surface,
            '--ctr-button-default-background-color-hovered': palette.surfaceMuted,
            '--ctr-button-default-text-color-default': palette.text,
            '--ctr-button-default-border-color-default': palette.border,

            // Toolbox (left rail)
            '--ctr-toolbox-background-color': palette.surface,
            '--ctr-toolbox-tool-background-color-hovered': palette.surfaceMuted,
            '--ctr-toolbox-tool-background-color-selected': palette.primarySoft,
            '--ctr-toolbox-tool-text-color-default': palette.text,
            '--ctr-toolbox-tool-text-color-selected': palette.primary,

            // Property grid (right rail)
            '--ctr-property-grid-background-color': palette.surface,
            '--ctr-property-grid-header-background-color': palette.surfaceMuted,
            '--ctr-property-grid-foreground': palette.text,

            // Page / element selection accent
            '--ctr-element-selected-border-color': palette.primary,
            '--ctr-element-selected-background-color': palette.primarySoft,

            // Tabs
            '--ctr-tab-background-color': palette.surface,
            '--ctr-tab-background-color-hovered': palette.surfaceMuted,
            '--ctr-tab-foreground': palette.text,
            '--ctr-tab-foreground-selected': palette.primary,
            '--ctr-tab-indicator-background-color': palette.primary,
        },
    };
}

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Runtime-mode helper for the SurveyJS plugin.
 *
 * Decides whether this plugin instance is running from a local Vite
 * dev server (via `node scripts/install-local.mjs --symlink` +
 * `npm --prefix frontend run dev:runtime`) or from a regular
 * registry / archive / connected install served through the host's
 * own origin.
 *
 * The check compares the origin of `import.meta.url` (the URL the
 * plugin module was actually fetched from) against the host
 * `window.location.origin`. Vite's dev runtime serves the entry on
 * a different port (default `http://localhost:5174`), so the origin
 * differs from the host (`http://localhost:3000`). A regular
 * install resolves the relative `/plugin-artifacts/<id>-<ver>/plugin.esm.js`
 * URL against the host origin, so the entry origin matches the host
 * and the result is `false`.
 *
 * This avoids touching the `@selfhelp/shared` IPluginApi contract:
 * the plugin can answer the dev-mode question on its own, without
 * needing a new SDK field. It also stays correct after dev live
 * reload because every re-import gets a fresh `import.meta.url`.
 *
 * Used by `SurveyAdminPage` to hide the "Developer live reload"
 * configuration panel from regular admins — the live-reload
 * instructions only apply to a `--symlink` dev install and are
 * confusing (and slightly leaky) when the plugin was installed
 * from the registry.
 */

export const IS_DEV_RUNTIME: boolean = (() => {
    try {
        if (typeof window === 'undefined' || typeof window.location === 'undefined') {
            return false;
        }
        const entryOrigin = new URL(import.meta.url).origin;
        return entryOrigin !== window.location.origin;
    } catch {
        return false;
    }
})();

/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * CSRF double-submit header helper for the plugin's browser API clients.
 *
 * The host frontend protects every unsafe (`POST`/`PUT`/`PATCH`/`DELETE`)
 * BFF request with a double-submit token: the value of the `sh_csrf` cookie
 * must be echoed back in the `X-CSRF-Token` header, and the BFF proxy
 * (`sh-selfhelp_frontend/src/app/api/_lib/proxy.ts#validateCsrf`) rejects
 * the request with `403 "CSRF validation failed"` when it does not match.
 *
 * CRITICAL — the host namespaces EVERY cookie per instance. The manager runs
 * many instances on one host separated only by port, and cookies are scoped
 * by host (not port, RFC 6265 §8.5), so the host suffixes each cookie with
 * the instance id, read in the browser from `<html data-sh-instance="…">`
 * (see the host's `src/config/cookie-names.ts`). On any manager-installed
 * instance the real cookie is therefore `sh_csrf_<instanceId>`, NOT plain
 * `sh_csrf`.
 *
 * The previous inline helper hardcoded `sh_csrf`, so on a namespaced instance
 * it found no cookie, sent no `X-CSRF-Token`, and EVERY survey mutation —
 * admin create/update/save-draft/publish AND public submit/upload — failed
 * with `403 CSRF validation failed` (surveys could not be created or
 * submitted). This helper derives the same per-instance name the host uses,
 * falls back to the un-suffixed cookie for plain dev checkouts (empty
 * suffix), and finally scans the jar so a present token is never missed.
 */

const CSRF_COOKIE_BASE = 'sh_csrf';

/**
 * Read the instance id the host mirrored onto `<html data-sh-instance>`.
 * Empty in a plain dev checkout (single-instance, un-suffixed cookies) and
 * on the server (no `document`).
 */
function readInstanceId(): string {
  if (typeof document !== 'undefined' && document.documentElement) {
    return document.documentElement.dataset.shInstance ?? '';
  }
  return '';
}

/**
 * Per-instance cookie suffix, identical to the host's `instanceCookieSuffix`
 * (sanitised to `[A-Za-z0-9_]`, prefixed with `_`). Empty when no instance
 * id is present, which preserves the historical single-instance cookie name.
 */
function instanceCookieSuffix(): string {
  const safe = readInstanceId().replace(/[^A-Za-z0-9_]/g, '');
  return safe ? `_${safe}` : '';
}

/** Read one cookie by exact name. Mirrors the host's `readCookieValue`. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const match = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

/**
 * Defensive last resort: return the value of any `sh_csrf` / `sh_csrf_*`
 * cookie in the jar. Covers the edge case where the `data-sh-instance`
 * attribute is somehow absent but the namespaced cookie was set.
 */
function scanCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq);
    if (name === CSRF_COOKIE_BASE || name.startsWith(`${CSRF_COOKIE_BASE}_`)) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return null;
}

/**
 * The CSRF token the host expects echoed in `X-CSRF-Token`, or `null` when
 * none is set (server-side render, or no session cookie yet).
 */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  // 1. Exact per-instance name the host set (`sh_csrf_<id>`, or `sh_csrf` in dev).
  const exact = readCookie(`${CSRF_COOKIE_BASE}${instanceCookieSuffix()}`);
  if (exact) return exact;
  // 2. Un-suffixed cookie (dev / single-instance / legacy).
  const legacy = readCookie(CSRF_COOKIE_BASE);
  if (legacy) return legacy;
  // 3. Any `sh_csrf*` cookie present.
  return scanCsrfCookie();
}

/**
 * Build the `{ 'X-CSRF-Token': … }` header for an unsafe request, or an
 * empty object when no token is available (the host then returns its own
 * 403, which the caller surfaces as a normal error).
 */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

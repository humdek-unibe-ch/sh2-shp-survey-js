/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Regression coverage for the per-instance CSRF cookie lookup.
 *
 * The host namespaces the CSRF cookie per instance (`sh_csrf_<id>`); the
 * earlier inline helper hardcoded `sh_csrf` and so sent no `X-CSRF-Token`
 * on a manager-installed instance, which made every survey create / submit
 * fail with `403 CSRF validation failed`. (jsdom env is set globally in
 * `vitest.config.ts`.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { csrfHeaders, readCsrfToken } from '../src/api/csrf';

function clearAllCookies(): void {
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  }
}

beforeEach(() => {
  clearAllCookies();
  delete document.documentElement.dataset.shInstance;
});

afterEach(() => {
  clearAllCookies();
  delete document.documentElement.dataset.shInstance;
});

describe('csrf cookie helper', () => {
  it('reads the un-suffixed cookie in a single-instance / dev checkout', () => {
    document.cookie = 'sh_csrf=devtoken; path=/';
    expect(readCsrfToken()).toBe('devtoken');
    expect(csrfHeaders()).toEqual({ 'X-CSRF-Token': 'devtoken' });
  });

  it('reads the per-instance namespaced cookie the host actually sets', () => {
    document.documentElement.dataset.shInstance = 'website1';
    document.cookie = 'sh_csrf_website1=nstoken; path=/';
    expect(readCsrfToken()).toBe('nstoken');
    expect(csrfHeaders()).toEqual({ 'X-CSRF-Token': 'nstoken' });
  });

  it('prefers the namespaced token over a stale un-suffixed one (the original CSRF bug)', () => {
    // The old helper matched `sh_csrf=` first and sent the legacy/stale token,
    // so the BFF rejected the request with 403 "CSRF validation failed".
    document.documentElement.dataset.shInstance = 'website1';
    document.cookie = 'sh_csrf=stale-legacy; path=/';
    document.cookie = 'sh_csrf_website1=correct-token; path=/';
    expect(readCsrfToken()).toBe('correct-token');
  });

  it('sanitises the instance id the same way the host does', () => {
    // The host strips everything outside [A-Za-z0-9_] before building the
    // cookie name, so a hyphenated id maps to the same suffix on both sides
    // (`clinic-a` -> `sh_csrf_clinica`).
    document.documentElement.dataset.shInstance = 'clinic-a';
    document.cookie = 'sh_csrf_clinica=ok; path=/';
    expect(readCsrfToken()).toBe('ok');
  });

  it('URL-decodes the cookie value', () => {
    document.cookie = 'sh_csrf=a%2Bb%2Fc; path=/';
    expect(readCsrfToken()).toBe('a+b/c');
  });

  it('returns no header when no csrf cookie is present', () => {
    expect(readCsrfToken()).toBeNull();
    expect(csrfHeaders()).toEqual({});
  });

  it('falls back to scanning when the instance attribute is missing but a namespaced cookie exists', () => {
    document.cookie = 'sh_csrf_website1=scan-me; path=/';
    expect(readCsrfToken()).toBe('scan-me');
  });
});

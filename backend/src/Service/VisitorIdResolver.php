<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Reads / writes the signed `_sh_sjs_vid` visitor cookie.
 *
 * Anonymous survey submissions need a stable id so the once-per-user
 * guard can dedupe repeat attempts from the same browser/profile.
 * The cookie carries `<visitorId>.<hmac>` where `hmac` is a SHA-256
 * HMAC of the id keyed by the plugin secret (env `SURVEYJS_VISITOR_SECRET`).
 *
 * This is intentionally weaker than authenticated session identity —
 * the cookie can be cleared / forged by a sufficiently determined
 * participant. The "Anonymous + once-per-user" risk note documents
 * this trade-off. Surveys that require guaranteed unique participation
 * MUST also require authentication.
 */
final class VisitorIdResolver
{
    public const COOKIE_NAME = '_sh_sjs_vid';
    private const COOKIE_LIFETIME_SECONDS = 365 * 24 * 3600;

    public function __construct(
        private readonly string $secret,
    ) {
    }

    /**
     * Returns the verified visitor id from the request, or `null` when
     * the cookie is absent / corrupted. A missing / invalid cookie is
     * NOT a hard error — the caller should mint a fresh id with
     * {@see issueCookie()} and attach it to the response.
     */
    public function resolveFromRequest(Request $request): ?string
    {
        $cookie = $request->cookies->get(self::COOKIE_NAME);
        if (!is_string($cookie) || $cookie === '') {
            return null;
        }
        $parts = explode('.', $cookie, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$id, $hmac] = $parts;
        $expected = $this->sign($id);
        if (!hash_equals($expected, $hmac)) {
            return null;
        }
        return $id;
    }

    public function mintVisitorId(): string
    {
        return strtoupper(bin2hex(random_bytes(16)));
    }

    public function issueCookie(string $visitorId): Cookie
    {
        $value = $visitorId . '.' . $this->sign($visitorId);
        return Cookie::create(self::COOKIE_NAME)
            ->withValue($value)
            ->withExpires(time() + self::COOKIE_LIFETIME_SECONDS)
            ->withPath('/')
            ->withSecure(true)
            ->withHttpOnly(true)
            ->withSameSite(Cookie::SAMESITE_LAX);
    }

    public function attachCookie(Response $response, string $visitorId): Response
    {
        $response->headers->setCookie($this->issueCookie($visitorId));
        return $response;
    }

    /**
     * Resolves the visitor id from the request or, if none exists,
     * mints a fresh one and attaches the cookie to the supplied
     * response. Always returns a non-empty id.
     */
    public function ensureVisitorId(Request $request, ?Response $response = null): string
    {
        $existing = $this->resolveFromRequest($request);
        if ($existing !== null) {
            return $existing;
        }
        $fresh = $this->mintVisitorId();
        if ($response !== null) {
            $this->attachCookie($response, $fresh);
        }
        return $fresh;
    }

    private function sign(string $id): string
    {
        return substr(hash_hmac('sha256', $id, $this->secret), 0, 32);
    }
}

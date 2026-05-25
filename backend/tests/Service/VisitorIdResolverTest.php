<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Service\VisitorIdResolver;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Visitor cookie integrity tests.
 *
 * The cookie is the only thing standing between an authenticated
 * "once per user" guard and the legacy plugin's broken behaviour
 * where anonymous users could submit unlimited times, so the
 * round-trip behaviour of issue + verify is worth pinning down with
 * dedicated tests.
 */
final class VisitorIdResolverTest extends TestCase
{
    public function testEnsureVisitorIdReusesValidCookie(): void
    {
        $resolver = new VisitorIdResolver('test-secret');
        $minted = $resolver->mintVisitorId();
        $cookie = $resolver->issueCookie($minted);

        $request = new Request();
        $request->cookies->set(VisitorIdResolver::COOKIE_NAME, $cookie->getValue());

        $resolved = $resolver->resolveFromRequest($request);
        self::assertSame($minted, $resolved);
    }

    public function testEnsureVisitorIdRejectsTamperedCookie(): void
    {
        $resolver = new VisitorIdResolver('test-secret');
        $minted = $resolver->mintVisitorId();
        $cookie = $resolver->issueCookie($minted);

        $request = new Request();
        $request->cookies->set(VisitorIdResolver::COOKIE_NAME, $cookie->getValue() . 'tamper');

        self::assertNull($resolver->resolveFromRequest($request));
    }

    public function testEnsureVisitorIdMintsAndAttachesCookieWhenMissing(): void
    {
        $resolver = new VisitorIdResolver('test-secret');
        $request = new Request();
        $response = new Response();

        $id = $resolver->ensureVisitorId($request, $response);
        self::assertNotEmpty($id);

        $sent = $response->headers->getCookies()[0] ?? null;
        self::assertInstanceOf(Cookie::class, $sent);
        self::assertSame(VisitorIdResolver::COOKIE_NAME, $sent->getName());
    }

    public function testDifferentSecretsRejectEachOthersCookies(): void
    {
        $signer = new VisitorIdResolver('secret-a');
        $verifier = new VisitorIdResolver('secret-b');
        $minted = $signer->mintVisitorId();
        $cookie = $signer->issueCookie($minted);

        $request = new Request();
        $request->cookies->set(VisitorIdResolver::COOKIE_NAME, $cookie->getValue());
        self::assertNull($verifier->resolveFromRequest($request));
    }
}

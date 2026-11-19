<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Exception\SurveyFileException;

/**
 * Short-lived signed links to a survey upload (a core form file key), so an
 * image, audio or GPX answer can be shown with a plain URL (no header for the
 * guest key). A link is only handed to whoever was allowed to read the answer
 * that names the file; the signature binds the key and the expiry.
 */
final class SignedFileUrlService
{
    public const QUERY_KEY = 'k';
    public const QUERY_SIGNATURE = 's';
    public const QUERY_EXPIRES = 'e';

    /** Browser path through the host BFF, which forwards to `/cms-api/v1/...`. */
    private const DOWNLOAD_PATH = '/api/plugins/sh2-shp-survey-js/files';
    private const DEFAULT_TTL_SECONDS = 3600;

    public function __construct(
        private readonly string $secret,
        private readonly int $defaultTtlSeconds = self::DEFAULT_TTL_SECONDS,
    ) {
    }

    public function url(string $key, ?int $ttlSeconds = null): string
    {
        $expires = time() + ($ttlSeconds ?? $this->defaultTtlSeconds);

        return self::DOWNLOAD_PATH . '?' . http_build_query([
            self::QUERY_KEY => $key,
            self::QUERY_EXPIRES => $expires,
            self::QUERY_SIGNATURE => $this->compute($key, $expires),
        ]);
    }

    public function verify(string $key, int $expires, string $signature): void
    {
        if ($expires < time()) {
            throw new SurveyFileException(SurveyFileException::REASON_SIGNATURE_EXPIRED, 'Signed URL has expired.');
        }
        if (!hash_equals($this->compute($key, $expires), $signature)) {
            throw new SurveyFileException(SurveyFileException::REASON_SIGNATURE_INVALID, 'Signed URL signature mismatch.');
        }
    }

    private function compute(string $key, int $expires): string
    {
        return rtrim(strtr(base64_encode(hash_hmac('sha256', $key . '|' . $expires, $this->secret, true)), '+/', '-_'), '=');
    }
}

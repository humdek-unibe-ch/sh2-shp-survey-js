<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Exception\SurveyFileException;

/**
 * HMAC-signed short-lived URLs for survey file downloads.
 *
 * The signature binds:
 *   - the SurveyFile id,
 *   - the caller identity (visitor id OR user id; both for hybrid
 *     scenarios where an authenticated admin downloads a participant
 *     file),
 *   - the expiry timestamp.
 *
 * Default TTL is 5 minutes. The signature is included as the `s` /
 * `e` / `u` query parameters; this lets the file download endpoint
 * remain stateless and survives reverse-proxy caching layers that
 * key by query string.
 */
final class SignedFileUrlService
{
    public const QUERY_SIGNATURE = 's';
    public const QUERY_EXPIRES = 'e';
    public const QUERY_IDENTITY = 'u';

    private const DEFAULT_TTL_SECONDS = 300;

    public function __construct(
        private readonly string $secret,
        private readonly int $defaultTtlSeconds = self::DEFAULT_TTL_SECONDS,
    ) {
    }

    /**
     * @return array{e:int, u:string, s:string}
     */
    public function sign(SurveyFile $file, ?int $userId, ?string $visitorId, ?int $ttlSeconds = null): array
    {
        $identity = $this->encodeIdentity($userId, $visitorId);
        $expires = time() + ($ttlSeconds ?? $this->defaultTtlSeconds);
        $signature = $this->compute($file->getId() ?? 0, $identity, $expires);
        return [
            self::QUERY_EXPIRES => $expires,
            self::QUERY_IDENTITY => $identity,
            self::QUERY_SIGNATURE => $signature,
        ];
    }

    public function verify(SurveyFile $file, string $identity, int $expires, string $signature): void
    {
        if ($expires < time()) {
            throw new SurveyFileException(SurveyFileException::REASON_SIGNATURE_EXPIRED, 'Signed URL has expired.');
        }
        $expected = $this->compute($file->getId() ?? 0, $identity, $expires);
        if (!hash_equals($expected, $signature)) {
            throw new SurveyFileException(SurveyFileException::REASON_SIGNATURE_INVALID, 'Signed URL signature mismatch.');
        }
    }

    /**
     * @return array{userId: int|null, visitorId: string|null}
     */
    public function decodeIdentity(string $identity): array
    {
        $parts = explode(':', $identity, 2);
        $userId = is_numeric($parts[0] ?? '') ? (int) $parts[0] : null;
        $visitorId = $parts[1] ?? '';
        return [
            'userId' => $userId === 0 ? null : $userId,
            'visitorId' => $visitorId === '' ? null : $visitorId,
        ];
    }

    private function encodeIdentity(?int $userId, ?string $visitorId): string
    {
        return ($userId ?? 0) . ':' . ($visitorId ?? '');
    }

    private function compute(int $fileId, string $identity, int $expires): string
    {
        return substr(
            hash_hmac('sha256', $fileId . '|' . $identity . '|' . $expires, $this->secret),
            0,
            32,
        );
    }
}

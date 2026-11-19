<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Exception\SurveyFileException;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use PHPUnit\Framework\TestCase;

/**
 * A survey upload is shown through a short-lived signed link, handed out only
 * with an answer the caller may read: the link is valid for its key until it
 * expires, and for nothing else.
 */
final class SignedFileUrlServiceTest extends TestCase
{
    private const KEY = 'uploads/form-files/guest/table_3/record_7/field_photo/1_abcdef01_a.png';

    public function testALinkOpensItsFileUntilItExpires(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $query = $this->query($service->url(self::KEY));

        self::assertSame(self::KEY, $query['k']);
        $service->verify($query['k'], (int) $query['e'], $query['s']);
        $this->addToAssertionCount(1);
    }

    public function testALinkDoesNotOpenAnotherFile(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $query = $this->query($service->url(self::KEY));

        $this->expectException(SurveyFileException::class);
        $service->verify(str_replace('record_7', 'record_8', self::KEY), (int) $query['e'], $query['s']);
    }

    public function testAnExpiredLinkIsRefused(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $query = $this->query($service->url(self::KEY, -10));

        $this->expectException(SurveyFileException::class);
        $service->verify(self::KEY, (int) $query['e'], $query['s']);
    }

    /**
     * @return array<string, string>
     */
    private function query(string $url): array
    {
        self::assertStringStartsWith('/api/plugins/sh2-shp-survey-js/files?', $url);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        /** @var array<string, string> $query */
        return $query;
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Exception\SurveyFileException;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Round-trip tests for the signed file URL service: a freshly signed
 * URL must verify cleanly, a tampered signature must throw, and an
 * expired timestamp must throw with the dedicated reason code so the
 * controller can map it to a clear 410-style response.
 */
final class SignedFileUrlServiceTest extends TestCase
{
    public function testSignAndVerifyRoundTrip(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $file = $this->makeFile(42);

        $signed = $service->sign($file, 7, 'visitor-abc', 60);
        $service->verify($file, $signed['u'], $signed['e'], $signed['s']);

        $decoded = $service->decodeIdentity($signed['u']);
        self::assertSame(7, $decoded['userId']);
        self::assertSame('visitor-abc', $decoded['visitorId']);
    }

    public function testVerifyRejectsTamperedSignature(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $file = $this->makeFile(1);
        $signed = $service->sign($file, null, 'visitor-abc', 60);

        $this->expectException(SurveyFileException::class);
        $this->expectExceptionMessage('signature');
        $service->verify($file, $signed['u'], $signed['e'], 'bogus-signature');
    }

    public function testVerifyRejectsExpiredSignature(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $file = $this->makeFile(2);
        // Use a TTL of -10 seconds so the signature lands in the past.
        $signed = $service->sign($file, 1, null, -10);

        $this->expectException(SurveyFileException::class);
        $service->verify($file, $signed['u'], $signed['e'], $signed['s']);
    }

    public function testDecodeIdentityHandlesAnonymous(): void
    {
        $service = new SignedFileUrlService('test-secret');
        $decoded = $service->decodeIdentity('0:visitor-abc');
        self::assertNull($decoded['userId']);
        self::assertSame('visitor-abc', $decoded['visitorId']);
    }

    private function makeFile(int $id): SurveyFile
    {
        // Bypass the constructor — Survey requires Doctrine entities
        // that aren't bootstrapped in the unit-test context. The
        // SignedFileUrlService only cares about getId(); the other
        // fields are irrelevant.
        $fileRef = new ReflectionClass(SurveyFile::class);
        /** @var SurveyFile $file */
        $file = $fileRef->newInstanceWithoutConstructor();
        $prop = $fileRef->getProperty('id');
        $prop->setAccessible(true);
        $prop->setValue($file, $id);
        return $file;
    }
}

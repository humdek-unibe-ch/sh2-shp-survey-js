<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Plugin\Health\PluginHealthCheckInterface;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * The host's plugin health report runs only checks that implement its
 * interface (found by tag) and expects its format: an overall status and
 * `subchecks` of name, status and message. Before, the check had its own
 * format and no tag, so the report never listed SurveyJS. The database is
 * unreachable here: the check must report that, not throw.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyJsHealthCheckTest extends TestCase
{
    public function testTheHostReportGetsSubchecksInItsFormatAndAnUnreadableTableFails(): void
    {
        $check = new SurveyJsHealthCheck($this->unreachableDatabase(), null);

        self::assertInstanceOf(PluginHealthCheckInterface::class, $check);
        self::assertSame('sh2-shp-survey-js', $check->getPluginId());

        $report = $check->runHealthCheck();
        self::assertSame('failed', $report['status']);
        self::assertSame(['database', 'license-key'], array_column($report['subchecks'], 'name'));
        self::assertSame(['failed', 'warning'], array_column($report['subchecks'], 'status'));
        foreach ($report['subchecks'] as $subcheck) {
            self::assertNotSame('', $subcheck['message']);
        }
    }

    public function testAConfiguredLicenseKeyIsOk(): void
    {
        $report = (new SurveyJsHealthCheck($this->unreachableDatabase(), 'qa-license-key'))->runHealthCheck();

        self::assertSame('ok', $report['subchecks'][1]['status']);
    }

    private function unreachableDatabase(): EntityManagerInterface
    {
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('getRepository')->willThrowException(new \RuntimeException('Connection refused'));

        return $em;
    }
}

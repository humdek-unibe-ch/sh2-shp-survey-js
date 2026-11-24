<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Service\CMS\DataTableService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Deleting a survey deletes all its answers, as the delete dialog says: the
 * core deletes its data table, which also erases the history and the uploads.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyServiceDeleteTest extends TestCase
{
    public function testDeletingASurveyDeletesItsDataTable(): void
    {
        $survey = new Survey('qa-delete', 'SV_QA0000000000DEL', []);
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('wrapInTransaction')->willReturnCallback(static fn (callable $work): mixed => $work());
        $em->expects(self::once())->method('remove')->with($survey);

        $tables = $this->createMock(DataTableService::class);
        $tables->expects(self::once())->method('deleteDataTable')->with('sh2_surveyjs_sv_qa0000000000del');

        $surveys = (new \ReflectionClass(SurveyRepository::class))->newInstanceWithoutConstructor();
        $versions = (new \ReflectionClass(SurveyVersionRepository::class))->newInstanceWithoutConstructor();
        \assert($surveys instanceof SurveyRepository && $versions instanceof SurveyVersionRepository);

        (new SurveyService(
            $em,
            $surveys,
            $versions,
            $this->createMock(SurveyJsRealtimePublisher::class),
            $tables,
        ))->delete($survey);
    }
}

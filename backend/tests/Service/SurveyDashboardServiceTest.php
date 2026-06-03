<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Backend certification unit coverage (Slice 8C) for
 * {@see SurveyDashboardService} — the lightweight aggregations the
 * admin Dashboard tab renders without polling.
 *
 * Pure unit tests: both repositories are mocked and Doctrine ids are
 * set by reflection, so the summary + flattened-results shapes are
 * asserted against the public contract (canonical Testing Rule 17)
 * without a database.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyDashboardServiceTest extends TestCase
{
    public function testBuildSummaryAggregatesCountsAndRecentRuns(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();

        $recent = new SurveyRun($survey, $version, 'R_1', 7, 'visitor-x');
        $recent->setStatus(SurveyRun::STATUS_COMPLETED);
        $recent->setIdDataRow(42);
        $this->setEntityId($recent, 100);

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('countCompletedForSurvey')->willReturn(3);
        $runs->method('countForSurvey')->willReturn(5);
        $runs->method('findRecentForSurvey')->willReturn([$recent]);

        $service = new SurveyDashboardService($runs, $this->createMock(SurveyAnswerLinkRepository::class));
        $summary = $service->buildSummary($survey);

        self::assertSame(1, $summary['id']);
        self::assertSame('SV_TEST', $summary['surveyId']);
        self::assertSame(3, $summary['completedResponses']);
        self::assertSame(5, $summary['totalResponses']);
        self::assertSame(1, $summary['currentVersionRevision']);

        self::assertCount(1, $summary['recent']);
        $row = $summary['recent'][0];
        self::assertSame(100, $row['id']);
        self::assertSame('R_1', $row['responseId']);
        self::assertSame('completed', $row['status']);
        self::assertSame(42, $row['idDataRow']);
        self::assertSame(7, $row['idUser']);
        self::assertSame('visitor-x', $row['visitorId']);
        self::assertNotNull($row['completedAt'], 'a completed run must expose completedAt as an ATOM string');
        self::assertNotFalse(\DateTimeImmutable::createFromFormat(DATE_ATOM, $row['startedAt']));
    }

    public function testBuildResultsFlattensRunsWithAnswerColumnsAndDecodesJson(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion(['pages' => [['name' => 'p1', 'elements' => []]]]);

        $run = new SurveyRun($survey, $version, 'R_2', 9, 'visitor-y');
        $run->setStatus(SurveyRun::STATUS_COMPLETED);
        $run->setProgress(['pageNo' => 2, 'triggerType' => 'finished']);
        $this->setEntityId($run, 200);

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findRecentForSurvey')->willReturn([$run]);

        $answerLinks = $this->createMock(SurveyAnswerLinkRepository::class);
        $answerLinks->method('findForRun')->willReturn([
            new SurveyAnswerLink($run, 'q_text', 'text', 'hello'),
            new SurveyAnswerLink($run, 'q_json', 'checkbox', '["a","b"]'),
        ]);

        $service = new SurveyDashboardService($runs, $answerLinks);
        $results = $service->buildResults($survey);

        self::assertSame('SV_TEST', $results['surveyId']);
        self::assertSame(['pages' => [['name' => 'p1', 'elements' => []]]], $results['definition']);
        self::assertCount(1, $results['rows']);

        $row = $results['rows'][0];
        self::assertSame(200, $row['record_id']);
        self::assertSame('R_2', $row['response_id']);
        self::assertSame(2, $row['page_no']);
        self::assertSame('finished', $row['trigger_type']);
        self::assertSame('completed', $row['status']);
        self::assertSame(1, $row['revision']);
        self::assertSame('hello', $row['q_text'], 'plain scalar answers pass through untouched');
        self::assertSame(['a', 'b'], $row['q_json'], 'JSON-encoded answers are decoded into arrays for the table');
    }

    public function testBuildResultsFallsBackToEmptyDefinitionAndUpdatedTriggerWithoutAVersionOrProgress(): void
    {
        // Survey deliberately has NO current version -> definition must
        // fall back to {pages: []}; the in-progress run with no progress
        // payload must surface trigger_type=updated and use startedAt.
        $survey = new Survey('Test', 'SV_TEST');
        $version = new SurveyVersion($survey, 1, ['pages' => []], null);
        $this->setEntityId($survey, 1);
        $this->setEntityId($version, 11);

        $run = new SurveyRun($survey, $version, 'R_3', null, 'visitor-z');
        $this->setEntityId($run, 300);

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findRecentForSurvey')->willReturn([$run]);

        $service = new SurveyDashboardService($runs, $this->createMock(SurveyAnswerLinkRepository::class));
        $results = $service->buildResults($survey);

        self::assertSame(['pages' => []], $results['definition']);
        self::assertCount(1, $results['rows']);
        self::assertSame(0, $results['rows'][0]['page_no']);
        self::assertSame('updated', $results['rows'][0]['trigger_type']);
        self::assertSame('in_progress', $results['rows'][0]['status']);
    }

    /**
     * @param array<string, mixed> $definition
     * @return array{0: Survey, 1: SurveyVersion}
     */
    private function buildSurveyWithVersion(array $definition = ['pages' => []]): array
    {
        $survey = new Survey('Test', 'SV_TEST');
        $version = new SurveyVersion($survey, 1, $definition, null);
        $this->setEntityId($survey, 1);
        $this->setEntityId($version, 11);
        $survey->setCurrentVersion($version);
        return [$survey, $version];
    }

    private function setEntityId(object $entity, int $id): void
    {
        $ref = new \ReflectionClass($entity);
        $prop = $ref->getProperty('id');
        $prop->setAccessible(true);
        $prop->setValue($entity, $id);
    }
}

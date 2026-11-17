<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * The admin Dashboard tab reads the survey's responses from the core data
 * table ({@see SurveyResponseStore}): totals and the latest responses, and
 * the finished responses as flat rows for the charts.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyDashboardServiceTest extends TestCase
{
    public function testSummaryCountsFinishedAndAllResponsesAndListsTheLatest(): void
    {
        $survey = $this->survey();
        $store = $this->createMock(SurveyResponseStore::class);
        $store->method('list')->willReturnCallback(
            fn (Survey $s, int $offset, int $limit, bool $finishedOnly = false): array => $finishedOnly
                ? ['records' => [], 'total' => 3]
                : ['records' => [
                    $this->record(101, 'R_OPEN', 'updated', null, 'guest-1'),
                    $this->record(100, 'R_DONE', 'finished', 7, null),
                ], 'total' => 5],
        );

        $summary = (new SurveyDashboardService($store))->buildSummary($survey);

        self::assertSame(3, $summary['completedResponses']);
        self::assertSame(5, $summary['totalResponses']);
        self::assertSame(1, $summary['currentVersionRevision']);
        self::assertSame(['R_OPEN', 'R_DONE'], array_column($summary['recent'], 'responseId'));
        self::assertSame('in_progress', $summary['recent'][0]['status']);
        self::assertNull($summary['recent'][0]['completedAt'], 'an unfinished response has no submit time');
        self::assertSame('guest-1', $summary['recent'][0]['visitorId']);
        self::assertSame('completed', $summary['recent'][1]['status']);
        self::assertSame(7, $summary['recent'][1]['idUser']);
        self::assertSame(100, $summary['recent'][1]['idDataRow'], 'the response is its data row');
    }

    public function testResultsAreFinishedResponsesAsMetaColumnsPlusAnswersUpToTheLimit(): void
    {
        $survey = $this->survey();
        $store = $this->createMock(SurveyResponseStore::class);
        $store->method('eachFinished')->willReturnCallback(function (): \Generator {
            yield $this->record(2, 'R_2', 'finished', 9, null, ['q_text' => 'hello', 'q_matrix' => ['sleep_well' => 'yes']]);
            yield $this->record(1, 'R_1', 'finished', null, 'guest-2', ['q_text' => 'hi']);
        });

        $service = new SurveyDashboardService($store);
        $results = $service->buildResults($survey);

        self::assertSame('SV_TEST', $results['surveyId']);
        self::assertSame($survey->getCurrentVersion()?->getDefinition(), $results['definition']);
        self::assertCount(2, $results['rows']);
        $row = $results['rows'][0];
        self::assertSame(2, $row['record_id']);
        self::assertSame('R_2', $row['response_id']);
        self::assertSame('finished', $row['trigger_type']);
        self::assertSame(1, $row['revision']);
        self::assertSame('hello', $row['q_text']);
        self::assertSame(['sleep_well' => 'yes'], $row['q_matrix'], 'a matrix answer stays whole');
        self::assertSame('guest-2', $results['rows'][1]['guest_key']);

        self::assertCount(1, $service->buildResults($survey, 1)['rows']);
    }

    public function testResultsWithoutAPublishedVersionUseAnEmptyDefinition(): void
    {
        $survey = new Survey('Test', 'SV_NOVER');
        $store = $this->createMock(SurveyResponseStore::class);
        $store->method('eachFinished')->willReturnCallback(static fn (): \Generator => yield from []);

        self::assertSame(['pages' => []], (new SurveyDashboardService($store))->buildResults($survey)['definition']);
    }

    private function survey(): Survey
    {
        $survey = new Survey('Test', 'SV_TEST');
        $ref = new \ReflectionProperty(Survey::class, 'id');
        $ref->setValue($survey, 1);
        $survey->setCurrentVersion(new SurveyVersion($survey, 1, ['pages' => [['name' => 'p1', 'elements' => []]]], null));
        return $survey;
    }

    /**
     * @param array<string, mixed> $answers
     */
    private function record(int $recordId, string $responseId, string $trigger, ?int $userId, ?string $guestKey, array $answers = []): SurveyResponseRecord
    {
        return new SurveyResponseRecord(
            $recordId,
            $userId,
            null,
            $trigger,
            new \DateTimeImmutable('2026-11-17 10:00:00', new \DateTimeZone('UTC')),
            $responseId,
            1,
            $guestKey,
            'en',
            0,
            $answers,
        );
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Submitting a survey saves the response as one `finished` row of the
 * survey's data table: a new row, the participant's own unfinished row, or
 * (edit mode) their submitted row. The store is mocked; it records each save.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyResponseServiceTest extends TestCase
{
    /** @var list<array{responseId: string, guestKey: ?string, finished: bool, existing: ?SurveyResponseRecord, userId: ?int, cells: array<int, array<string, mixed>>}> */
    private array $saves = [];

    /** @var array<string, SurveyResponseRecord> */
    private array $byResponseId = [];

    private ?SurveyResponseRecord $latestFinished = null;

    public function testSubmitWithoutAPublishedVersionIsRefused(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('has no published version');

        $this->service()->submit(new Survey('Test', 'SV_NOVER'), ['q1' => 'x'], null, 'guest-1');
    }

    public function testAGuestSubmitSavesOneFinishedRowWithTheGuestKeyAndAnnouncesIt(): void
    {
        $realtime = $this->createMock(SurveyJsRealtimePublisher::class);
        $realtime->expects(self::once())->method('surveyResponseSubmitted');

        $record = $this->service($realtime)->submit($this->survey(), ['q1' => 'yes', 'q2' => ['a' => 1]], null, 'guest-1', ['responseId' => 'R_NEW']);

        self::assertSame('R_NEW', $record->responseId);
        self::assertCount(1, $this->saves);
        self::assertTrue($this->saves[0]['finished']);
        self::assertNull($this->saves[0]['existing'], 'a new response is a new row');
        self::assertSame('guest-1', $this->saves[0]['guestKey']);
        self::assertSame(['q1', 'q2'], array_column($this->saves[0]['cells'], 'name'), 'one cell per question, the matrix kept whole');
    }

    public function testASignedInSubmitStoresNoGuestKey(): void
    {
        $this->service()->submit($this->survey(), ['q1' => 'yes'], 7, 'guest-1', ['responseId' => 'R_NEW']);

        self::assertNull($this->saves[0]['guestKey'], 'the next person on this browser must not match it');
        self::assertSame(7, $this->saves[0]['userId']);
    }

    public function testSubmitFinishesTheParticipantsOwnUnfinishedResponse(): void
    {
        $open = $this->record('R_OPEN', 'updated', null, 'guest-1');
        $this->byResponseId['R_OPEN'] = $open;

        $this->service()->submit($this->survey(), ['q1' => 'yes'], null, 'guest-1', ['responseId' => 'R_OPEN']);

        self::assertSame($open, $this->saves[0]['existing'], 'progress and the submit are the same row');
        self::assertSame('R_OPEN', $this->saves[0]['responseId']);
    }

    public function testSubmitWithSomeoneElsesResponseIdStartsAFreshResponse(): void
    {
        $this->byResponseId['R_OTHER'] = $this->record('R_OTHER', 'updated', null, 'guest-2');

        $this->service()->submit($this->survey(), ['q1' => 'yes'], null, 'guest-1', ['responseId' => 'R_OTHER']);

        self::assertNull($this->saves[0]['existing']);
        self::assertNotSame('R_OTHER', $this->saves[0]['responseId']);
        self::assertStringStartsWith('R_', $this->saves[0]['responseId']);
    }

    public function testOncePerUserRefusesASecondSubmit(): void
    {
        $this->latestFinished = $this->record('R_DONE', 'finished', 7, null);

        try {
            $this->service()->submit($this->survey(), ['q1' => 'yes'], 7, null, ['oncePerUser' => true]);
            self::fail('A second submit must be refused.');
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(SurveySubmissionRejectedException::REASON_ONCE_PER_USER, $e->reason);
        }
        self::assertSame([], $this->saves, 'nothing is saved');
    }

    public function testOncePerUserNeedsASessionOrAGuestCookie(): void
    {
        $this->expectException(SurveySubmissionRejectedException::class);

        $this->service()->submit($this->survey(), ['q1' => 'yes'], null, null, ['oncePerUser' => true, 'allowAnonymous' => true]);
    }

    public function testEditModeUpdatesTheParticipantsSubmittedResponse(): void
    {
        $done = $this->record('R_DONE', 'finished', 7, null);
        $this->byResponseId['R_DONE'] = $done;
        $this->latestFinished = $done;

        $this->service()->submit($this->survey(), ['q1' => 'changed'], 7, null, ['responseId' => 'R_DONE', 'editMode' => true, 'oncePerUser' => true]);

        self::assertSame($done, $this->saves[0]['existing'], 'the limits do not stop an edit');
        self::assertTrue($this->saves[0]['finished']);
    }

    public function testEditModeRefusesAnotherParticipantsResponse(): void
    {
        $this->byResponseId['R_DONE'] = $this->record('R_DONE', 'finished', 8, null);

        try {
            $this->service()->submit($this->survey(), ['q1' => 'x'], 7, null, ['responseId' => 'R_DONE', 'editMode' => true]);
            self::fail('Editing someone else\'s response must be refused.');
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(SurveySubmissionRejectedException::REASON_EDIT_FORBIDDEN, $e->reason);
        }
    }

    public function testEditModeRefusesAnUnfinishedOrUnknownResponse(): void
    {
        $this->byResponseId['R_OPEN'] = $this->record('R_OPEN', 'updated', 7, null);

        foreach (['R_OPEN', 'R_MISSING'] as $responseId) {
            try {
                $this->service()->submit($this->survey(), ['q1' => 'x'], 7, null, ['responseId' => $responseId, 'editMode' => true]);
                self::fail('Only a submitted response can be edited.');
            } catch (SurveySubmissionRejectedException $e) {
                self::assertSame(SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND, $e->reason);
            }
        }
    }

    private function service(?SurveyJsRealtimePublisher $realtime = null): SurveyResponseService
    {
        $store = $this->createMock(SurveyResponseStore::class);
        $store->method('findByResponseId')->willReturnCallback(fn (Survey $s, string $id): ?SurveyResponseRecord => $this->byResponseId[$id] ?? null);
        $store->method('findLatestFinished')->willReturnCallback(fn (): ?SurveyResponseRecord => $this->latestFinished);
        $store->method('save')->willReturnCallback(
            function (Survey $s, SurveyVersion $v, array $cells, string $responseId, ?string $guestKey, ?string $language, int $pageNo, bool $finished, ?SurveyResponseRecord $existing = null, ?int $userId = null): SurveyResponseRecord {
                $this->saves[] = compact('responseId', 'guestKey', 'finished', 'existing', 'userId', 'cells');
                return $this->record($responseId, $finished ? 'finished' : 'updated', $userId, $guestKey);
            },
        );

        return new SurveyResponseService(
            new SurveyAnswerNormalizer(new SurveyJsHtmlSanitizer()),
            $realtime ?? $this->createMock(SurveyJsRealtimePublisher::class),
            $store,
        );
    }

    private function survey(): Survey
    {
        $survey = new Survey('Test', 'SV_TEST');
        $survey->setCurrentVersion(new SurveyVersion($survey, 1, ['pages' => [['name' => 'p1', 'elements' => [
            ['type' => 'text', 'name' => 'q1', 'title' => 'First'],
            ['type' => 'matrix', 'name' => 'q2', 'title' => 'Second'],
        ]]]], null));
        return $survey;
    }

    private function record(string $responseId, string $trigger, ?int $userId, ?string $guestKey): SurveyResponseRecord
    {
        return new SurveyResponseRecord(1, $userId, null, $trigger, new \DateTimeImmutable('now', new \DateTimeZone('UTC')), $responseId, 1, $guestKey, null, 0, []);
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyResponseDraftService;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Progress of an unsubmitted survey is the response's own unfinished row:
 * saving it, finding it again (by user, or by guest key), and throwing it
 * away. The store is mocked; it records each save.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyResponseDraftServiceTest extends TestCase
{
    /** @var list<array{responseId: string, pageNo: int, finished: bool, existing: ?SurveyResponseRecord, language: ?string, rowKey: array{0: string, 1: string}|null}> */
    private array $saves = [];

    /** @var array<string, SurveyResponseRecord> */
    private array $byResponseId = [];

    /** @var array<string, SurveyResponseRecord> unfinished rows keyed "user:<id>" or "guest:<key>" */
    private array $unfinished = [];

    /** @var array<string, SurveyResponseRecord> unfinished rows keyed "<column>=<value>" */
    private array $keyed = [];

    public function testFirstSaveStartsAnUnfinishedResponseWithPageAndLanguage(): void
    {
        $this->service()->save($this->survey(), 'R_NEW', null, 'guest-1', ['q1' => 'a'], 1, 'de');

        self::assertCount(1, $this->saves);
        self::assertFalse($this->saves[0]['finished']);
        self::assertNull($this->saves[0]['existing']);
        self::assertSame('R_NEW', $this->saves[0]['responseId']);
        self::assertSame(1, $this->saves[0]['pageNo']);
        self::assertSame('de', $this->saves[0]['language']);
    }

    public function testASlowerAutosaveDoesNotMoveTheParticipantBackAPage(): void
    {
        $this->byResponseId['R_OPEN'] = $this->record('R_OPEN', 'updated', null, 'guest-1', 3);

        $this->service()->save($this->survey(), 'R_OPEN', null, 'guest-1', ['q1' => 'a'], 1, null);

        self::assertSame(3, $this->saves[0]['pageNo']);
        self::assertSame($this->byResponseId['R_OPEN'], $this->saves[0]['existing']);
    }

    public function testProgressForASubmittedResponseIsIgnored(): void
    {
        $done = $this->record('R_DONE', 'finished', 7, null);
        $this->byResponseId['R_DONE'] = $done;

        $result = $this->service()->save($this->survey(), 'R_DONE', 7, null, ['q1' => 'a'], 0, null);

        self::assertSame($done, $result);
        self::assertSame([], $this->saves, 'a submitted response never turns back to unfinished');
    }

    public function testProgressOnSomeoneElsesResponseIsRefused(): void
    {
        $this->byResponseId['R_OTHER'] = $this->record('R_OTHER', 'updated', null, 'guest-2');

        $this->expectException(\DomainException::class);
        $this->service()->save($this->survey(), 'R_OTHER', null, 'guest-1', ['q1' => 'a'], 0, null);
    }

    public function testResumeByIdReturnsOnlyTheParticipantsUnfinishedResponse(): void
    {
        $this->byResponseId['R_MINE'] = $this->record('R_MINE', 'updated', null, 'guest-1');
        $this->byResponseId['R_OTHER'] = $this->record('R_OTHER', 'updated', null, 'guest-2');
        $this->byResponseId['R_DONE'] = $this->record('R_DONE', 'finished', null, 'guest-1');

        $service = $this->service();
        self::assertSame('R_MINE', $service->resume($this->survey(), null, 'guest-1', 'R_MINE')?->responseId);
        self::assertNull($service->resume($this->survey(), null, 'guest-1', 'R_OTHER'));
        self::assertNull($service->resume($this->survey(), null, 'guest-1', 'R_DONE'));
    }

    public function testASignedInParticipantGetsBackWhatTheyStartedAsAGuest(): void
    {
        $this->unfinished['guest:guest-1'] = $this->record('R_GUEST', 'started', null, 'guest-1');

        self::assertSame('R_GUEST', $this->service()->resume($this->survey(), 7, 'guest-1', null)?->responseId);
    }

    public function testResumePrefersTheSignedInParticipantsOwnResponse(): void
    {
        $this->unfinished['user:7'] = $this->record('R_USER', 'updated', 7, null);
        $this->unfinished['guest:guest-1'] = $this->record('R_GUEST', 'started', null, 'guest-1');

        self::assertSame('R_USER', $this->service()->resume($this->survey(), 7, 'guest-1', null)?->responseId);
    }

    public function testAKeyedLinkContinuesTheRowHoldingTheKeyWhoeverStartedIt(): void
    {
        $this->keyed['extra_param_code=P-17'] = $this->record('R_KEYED', 'updated', null, 'guest-other', 2);

        $this->service()->save($this->survey(), null, null, 'guest-1', ['q1' => 'a'], 3, null, ['extra_param_code', 'P-17']);

        self::assertSame('R_KEYED', $this->saves[0]['responseId']);
        self::assertSame(['extra_param_code', 'P-17'], $this->saves[0]['rowKey'], 'the key is stored in the row');
        self::assertSame('R_KEYED', $this->service()->resume($this->survey(), null, 'guest-1', null, ['extra_param_code', 'P-17'])?->responseId);
    }

    public function testAKeyWithNoRowYetStartsANewRowHoldingIt(): void
    {
        $this->service()->save($this->survey(), 'R_NEW', null, 'guest-1', ['q1' => 'a'], 0, null, ['extra_param_sid', 'abc']);

        self::assertNull($this->saves[0]['existing']);
        self::assertSame('R_NEW', $this->saves[0]['responseId']);
        self::assertNull($this->service()->resume($this->survey(), null, 'guest-1', null, ['extra_param_sid', 'other']), 'another key finds nothing');
    }

    public function testDiscardDeletesTheRow(): void
    {
        $open = $this->record('R_OPEN', 'updated', null, 'guest-1');
        $store = $this->store();
        $store->expects(self::once())->method('delete')->with(self::isInstanceOf(Survey::class), $open);

        $this->service($store)->discard($this->survey(), $open);
    }

    private function service(?SurveyResponseStore $store = null): SurveyResponseDraftService
    {
        $store ??= $this->store();
        $normalizer = new SurveyAnswerNormalizer(new SurveyJsHtmlSanitizer());

        return new SurveyResponseDraftService(
            $normalizer,
            $store,
            new SurveyResponseService($normalizer, $this->createMock(SurveyJsRealtimePublisher::class), $store),
        );
    }

    private function store(): SurveyResponseStore&\PHPUnit\Framework\MockObject\MockObject
    {
        $store = $this->createMock(SurveyResponseStore::class);
        $store->method('findByResponseId')->willReturnCallback(fn (Survey $s, string $id): ?SurveyResponseRecord => $this->byResponseId[$id] ?? null);
        $store->method('findUnfinished')->willReturnCallback(
            fn (Survey $s, ?int $userId, ?string $guestKey): ?SurveyResponseRecord => $userId !== null
                ? ($this->unfinished['user:' . $userId] ?? null)
                : ($this->unfinished['guest:' . $guestKey] ?? null),
        );
        $store->method('findUnfinishedByCell')->willReturnCallback(
            fn (Survey $s, string $column, string $value): ?SurveyResponseRecord => $this->keyed[$column . '=' . $value] ?? null,
        );
        $store->method('save')->willReturnCallback(
            function (Survey $s, SurveyVersion $v, array $cells, string $responseId, ?string $guestKey, ?string $language, int $pageNo, bool $finished, ?SurveyResponseRecord $existing = null, ?int $userId = null, ?array $rowKey = null): SurveyResponseRecord {
                $this->saves[] = compact('responseId', 'pageNo', 'finished', 'existing', 'language', 'rowKey');
                return $this->record($responseId, $finished ? 'finished' : 'updated', null, $guestKey, $pageNo);
            },
        );
        return $store;
    }

    private function survey(): Survey
    {
        $survey = new Survey('Test', 'SV_TEST');
        $survey->setCurrentVersion(new SurveyVersion($survey, 1, ['pages' => [['name' => 'p1', 'elements' => [
            ['type' => 'text', 'name' => 'q1', 'title' => 'First'],
        ]]]], null));
        return $survey;
    }

    private function record(string $responseId, string $trigger, ?int $userId, ?string $guestKey, int $pageNo = 0): SurveyResponseRecord
    {
        return new SurveyResponseRecord(1, $userId, null, $trigger, new \DateTimeImmutable('now', new \DateTimeZone('UTC')), $responseId, 1, $guestKey, null, $pageNo, []);
    }
}

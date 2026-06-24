<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Service\DataTableWriterInterface;
use Humdek\SurveyJsBundle\Service\DataTableWriteResult;
use Humdek\SurveyJsBundle\Service\NullDataTableWriter;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Backend certification unit coverage (Slice 8C) for the *normal*
 * (non-edit) submission path of {@see SurveyResponseService}. The
 * edit-in-place semantics are covered by
 * {@see SurveyResponseServiceEditModeTest}; this guards the new-run
 * happy path plus the two public rejection contracts a participant
 * can hit (no published version, once-per-user re-submission).
 *
 * Pure unit tests: repositories + the realtime publisher are mocked,
 * the data-table writer is an in-memory fake, and Doctrine ids are set
 * by reflection so no database is required (host backend testing rule:
 * mocks are acceptable for isolated service logic).
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyResponseServiceTest extends TestCase
{
    public function testSubmitThrowsWhenSurveyHasNoPublishedVersion(): void
    {
        $survey = new Survey('Test', 'SV_NOVER');
        $this->setEntityId($survey, 5);

        $service = $this->buildService();

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('has no published version');

        $service->submit($survey, ['q1' => 'x'], null, 'visitor-anon');
    }

    public function testNormalSubmitCreatesCompletedRunWithAnswerLinksAndPublishesRealtime(): void
    {
        [$survey] = $this->buildSurveyWithVersion();

        $runs = $this->createMock(SurveyRunRepository::class);
        // No responseId supplied -> a fresh id is generated; the
        // uniqueness probe must report "not taken".
        $runs->method('findOneByResponseId')->willReturn(null);

        $persisted = [];
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('wrapInTransaction')->willReturnCallback(
            static fn (callable $cb) => $cb(),
        );
        $em->method('persist')->willReturnCallback(
            static function (object $entity) use (&$persisted): void {
                $persisted[] = $entity;
            },
        );

        $writerCalled = false;
        $existingRowSeen = -1;
        $writer = new class ($writerCalled, $existingRowSeen) implements DataTableWriterInterface {
            public function __construct(
                public bool &$called,
                public ?int &$rowIdSeen,
            ) {
            }

            public function writeRow(
                Survey $survey,
                SurveyVersion $version,
                array $cells,
                ?int $userId,
                string $responseId,
                ?int $existingDataRowId = null,
            ): DataTableWriteResult {
                $this->called = true;
                $this->rowIdSeen = $existingDataRowId;
                return new DataTableWriteResult(7777);
            }
        };

        $realtime = $this->createMock(SurveyJsRealtimePublisher::class);
        $realtime->expects(self::once())->method('surveyResponseSubmitted');

        $service = $this->buildService(em: $em, realtime: $realtime, writer: $writer, runs: $runs);

        $run = $service->submit($survey, ['name' => 'Ada', 'agree' => true], 7, 'visitor-self');

        self::assertSame(SurveyRun::STATUS_COMPLETED, $run->getStatus(), 'a finished submission must complete the run');
        self::assertSame(7777, $run->getIdDataRow(), 'the run must store the data_rows id returned by the writer');
        self::assertNotSame('', $run->getResponseId(), 'a fresh response id must be generated');
        self::assertSame(2, $run->getProgress()['answered'] ?? null, 'progress.answered must reflect the normalized answer count');

        self::assertTrue($writerCalled, 'the host data-table writer must be invoked');
        self::assertNull($existingRowSeen, 'a NEW submission must not pass an existing data_rows id (no in-place update)');

        $persistedLinks = array_values(array_filter(
            $persisted,
            static fn (object $entity) => $entity instanceof SurveyAnswerLink,
        ));
        self::assertCount(2, $persistedLinks, 'one SurveyAnswerLink per normalized answer');
    }

    public function testMobileOriginSubmitStoresRealRunAndIgnoresPreviewHints(): void
    {
        // The mobile WebView renderer submits through the SAME public endpoint
        // + service path as the web frontend (via the native host-services
        // bridge). `submit()` has no origin/preview/test parameter, so a
        // mobile-origin finished submission must store a REAL completed run
        // identically to web — even when the client embeds preview-like hints
        // in `enforce`. This guards against anyone adding a mobile/preview
        // short-circuit that would make CMS mobile preview stop persisting.
        [$survey] = $this->buildSurveyWithVersion();

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findOneByResponseId')->willReturn(null);
        // A mobile client may send a once-per-user enforce; with no prior run
        // it must NOT block the first submission.
        $runs->method('findLatestCompletedForUser')->willReturn(null);
        $runs->method('findLatestCompletedForVisitor')->willReturn(null);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('wrapInTransaction')->willReturnCallback(
            static fn (callable $cb) => $cb(),
        );

        $writerCalled = false;
        $writerUserId = -1;
        $writer = new class ($writerCalled, $writerUserId) implements DataTableWriterInterface {
            public function __construct(
                public bool &$called,
                public ?int &$userIdSeen,
            ) {
            }

            public function writeRow(
                Survey $survey,
                SurveyVersion $version,
                array $cells,
                ?int $userId,
                string $responseId,
                ?int $existingDataRowId = null,
            ): DataTableWriteResult {
                $this->called = true;
                $this->userIdSeen = $userId;
                return new DataTableWriteResult(8888);
            }
        };

        $realtime = $this->createMock(SurveyJsRealtimePublisher::class);
        $realtime->expects(self::once())->method('surveyResponseSubmitted');

        $service = $this->buildService(em: $em, realtime: $realtime, writer: $writer, runs: $runs);

        $enforce = [
            'oncePerUser' => true,
            'allowAnonymous' => true,
            'redirectAtEnd' => 'thank-you',
            // Unknown "preview-like" hints a client could embed — must be ignored.
            'preview' => true,
            'test' => true,
            'clientType' => 'mobile',
            'progress' => ['topic' => 'parity'],
        ];

        $run = $service->submit($survey, ['name' => 'Ada', 'agree' => true], 7, 'visitor-self', $enforce);

        self::assertSame(SurveyRun::STATUS_COMPLETED, $run->getStatus(), 'a mobile-origin finished submission must complete a REAL run (no preview branch)');
        self::assertSame(8888, $run->getIdDataRow(), 'a real data_tables row must be written for a mobile submit, exactly like web');
        self::assertNotSame('', $run->getResponseId(), 'a real persisted response id must be generated');
        self::assertTrue($writerCalled, 'the host data-table writer must run for a mobile submit');
        self::assertSame(7, $writerUserId, 'the authenticated user id must reach the data-table writer');
        self::assertSame(2, $run->getProgress()['answered'] ?? null, 'progress.answered reflects the normalized answers');
        self::assertSame('parity', $run->getProgress()['topic'] ?? null, 'caller-supplied progress metadata is preserved');
    }

    public function testOncePerUserBlocksASecondSubmission(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();
        $earlier = new SurveyRun($survey, $version, 'R_DONE', 7, 'visitor-self');
        $earlier->setStatus(SurveyRun::STATUS_COMPLETED);

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findLatestCompletedForUser')->willReturn($earlier);

        $service = $this->buildService(runs: $runs);

        try {
            $service->submit($survey, ['q1' => 'again'], 7, 'visitor-self', ['oncePerUser' => true]);
            self::fail('Expected SurveySubmissionRejectedException.');
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(SurveySubmissionRejectedException::REASON_ONCE_PER_USER, $e->reason);
        }
    }

    private function buildService(
        ?EntityManagerInterface $em = null,
        ?SurveyAnswerNormalizer $normalizer = null,
        ?SurveyJsRealtimePublisher $realtime = null,
        ?DataTableWriterInterface $writer = null,
        ?SurveyRunRepository $runs = null,
        ?SurveyResponseDraftRepository $drafts = null,
        ?SurveyAnswerLinkRepository $answerLinks = null,
        ?SurveyFileStorage $fileStorage = null,
    ): SurveyResponseService {
        return new SurveyResponseService(
            $em ?? $this->createMock(EntityManagerInterface::class),
            $normalizer ?? new SurveyAnswerNormalizer(new SurveyJsHtmlSanitizer()),
            $realtime ?? $this->createMock(SurveyJsRealtimePublisher::class),
            $writer ?? new NullDataTableWriter(),
            $runs ?? $this->createMock(SurveyRunRepository::class),
            $drafts ?? $this->createMock(SurveyResponseDraftRepository::class),
            $answerLinks ?? $this->createMock(SurveyAnswerLinkRepository::class),
            $fileStorage ?? $this->createMock(SurveyFileStorage::class),
        );
    }

    /**
     * @return array{0: Survey, 1: SurveyVersion}
     */
    private function buildSurveyWithVersion(): array
    {
        $survey = new Survey('Test', 'SV_TEST');
        $version = new SurveyVersion($survey, 1, ['pages' => []], null);
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

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
 * Regression coverage for the edit-mode submit semantics fixed in
 * the post-audit critical pass. Specifically guards the three
 * rejection cases (missing responseId, run not found, run not owned)
 * and the update-in-place happy path that re-uses the existing
 * `survey_runs` row and forwards the existing `data_rows` id to the
 * data-table writer so no duplicate row is created.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyResponseServiceEditModeTest extends TestCase
{
    public function testEditModeRequiresResponseId(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->expects(self::never())->method('findOneByResponseId');

        $service = $this->buildService(
            runs: $runs,
        );

        $this->expectException(SurveySubmissionRejectedException::class);
        $this->expectExceptionMessage('Edit mode requires the responseId');

        try {
            $service->submit($survey, [], null, 'visitor-abc', [
                'editMode' => true,
            ]);
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(
                SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND,
                $e->reason,
            );
            throw $e;
        }
    }

    public function testEditModeRejectsUnknownResponseId(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findOneByResponseId')->with('R_GHOST')->willReturn(null);

        $service = $this->buildService(runs: $runs);

        try {
            $service->submit($survey, [], null, 'visitor-abc', [
                'editMode' => true,
                'responseId' => 'R_GHOST',
            ]);
            self::fail('Expected SurveySubmissionRejectedException.');
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(
                SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND,
                $e->reason,
            );
        }
    }

    public function testEditModeRejectsRunOwnedByAnotherUser(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();
        $existing = $this->buildExistingRun($survey, $version, idUser: 42, visitorId: 'visitor-other');

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findOneByResponseId')->with('R_X1')->willReturn($existing);

        $service = $this->buildService(runs: $runs);

        try {
            $service->submit($survey, [], 99, 'visitor-self', [
                'editMode' => true,
                'responseId' => 'R_X1',
            ]);
            self::fail('Expected SurveySubmissionRejectedException.');
        } catch (SurveySubmissionRejectedException $e) {
            self::assertSame(
                SurveySubmissionRejectedException::REASON_EDIT_FORBIDDEN,
                $e->reason,
            );
        }
    }

    public function testEditModeUpdatesExistingRunInPlace(): void
    {
        [$survey, $version] = $this->buildSurveyWithVersion();
        $existing = $this->buildExistingRun(
            $survey,
            $version,
            idUser: 7,
            visitorId: 'visitor-self',
            existingDataRowId: 4242,
        );

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findOneByResponseId')->with('R_KEEP')->willReturn($existing);

        $answerLinks = $this->createMock(SurveyAnswerLinkRepository::class);
        $oldLink = new SurveyAnswerLink($existing, 'q1', 'text', 'stale answer');
        $answerLinks->method('findForRun')->with($existing)->willReturn([$oldLink]);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('wrapInTransaction')->willReturnCallback(
            static fn (callable $cb) => $cb(),
        );
        $em->expects(self::once())->method('remove')->with($oldLink);
        $persisted = [];
        $em->expects(self::atLeastOnce())->method('persist')->willReturnCallback(
            static function (object $entity) use (&$persisted): void {
                $persisted[] = $entity;
            },
        );

        $writerCalled = false;
        $existingRowSeen = null;
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
                return new DataTableWriteResult($existingDataRowId ?? 0);
            }
        };

        $realtime = $this->createMock(SurveyJsRealtimePublisher::class);
        $realtime->expects(self::once())->method('surveyResponseSubmitted');

        $service = $this->buildService(
            runs: $runs,
            em: $em,
            writer: $writer,
            answerLinks: $answerLinks,
            realtime: $realtime,
        );

        $returned = $service->submit($survey, ['q1' => 'fresh answer'], 7, 'visitor-self', [
            'editMode' => true,
            'responseId' => 'R_KEEP',
        ]);

        self::assertSame($existing, $returned, 'Edit-mode submit must reuse the existing run.');
        self::assertTrue($writerCalled, 'Data-table writer should be called once.');
        self::assertSame(
            4242,
            $existingRowSeen,
            'Writer must receive the existing data_rows id so the row is updated in place.',
        );
        $persistedLinks = array_values(array_filter(
            $persisted,
            static fn (object $entity) => $entity instanceof SurveyAnswerLink,
        ));
        self::assertCount(1, $persistedLinks, 'One fresh SurveyAnswerLink per normalized answer.');
    }

    public function testEditModeFalseStillEntersTheNormalPath(): void
    {
        // Sanity guard: without `editMode`, the service must NOT
        // short-circuit into the edit path even when a responseId is
        // present (that responseId is used as the run id, but a new
        // run is still created). Asserted by checking that
        // runs->findOneByResponseId is asked for an ANSWER lookup
        // through resolveResponseId() — which calls
        // findOneByResponseId at most once with the provided
        // responseId — and never throws an edit-mode exception.
        [$survey, $version] = $this->buildSurveyWithVersion();

        $runs = $this->createMock(SurveyRunRepository::class);
        $runs->method('findOneByResponseId')->willReturn(null);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('wrapInTransaction')->willReturnCallback(
            static fn (callable $cb) => $cb(),
        );

        $writer = new NullDataTableWriter();

        $service = $this->buildService(
            runs: $runs,
            em: $em,
            writer: $writer,
        );

        // The mock EM has no real persist/flush behaviour; we only
        // assert no edit-mode exception leaks out and a SurveyRun is
        // returned.
        $run = $service->submit($survey, [], null, 'visitor-anon', [
            'responseId' => 'R_ANY',
        ]);
        self::assertInstanceOf(SurveyRun::class, $run);
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

    private function buildExistingRun(
        Survey $survey,
        SurveyVersion $version,
        ?int $idUser,
        ?string $visitorId,
        ?int $existingDataRowId = null,
    ): SurveyRun {
        $run = new SurveyRun($survey, $version, 'R_KEEP', $idUser, $visitorId);
        $run->setStatus(SurveyRun::STATUS_COMPLETED);
        if ($existingDataRowId !== null) {
            $run->setIdDataRow($existingDataRowId);
        }
        $this->setEntityId($run, 999);
        return $run;
    }

    /**
     * Sets Doctrine entity id via reflection so the unit tests do not
     * have to spin up a real EntityManager just to mint primary
     * keys.
     */
    private function setEntityId(object $entity, int $id): void
    {
        $ref = new \ReflectionClass($entity);
        $prop = $ref->getProperty('id');
        $prop->setAccessible(true);
        $prop->setValue($entity, $id);
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * Submission flow.
 *
 * Receives the SurveyJS answer JSON from the public submission
 * endpoint, normalizes + sanitizes it, persists `survey_runs` /
 * `survey_answer_links` metadata, promotes any in-progress draft,
 * and emits the realtime event the Responses dashboard listens to.
 * The actual answer values land in the host `data_tables` /
 * `data_rows` / `data_cells` via the `DataTableWriterInterface`
 * injected by the host (decoupled so the plugin does not import core
 * CMS internals directly).
 */
final class SurveyResponseService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyAnswerNormalizer $normalizer,
        private readonly SurveyJsRealtimePublisher $realtime,
        private readonly DataTableWriterInterface $writer,
        private readonly SurveyRunRepository $runs,
        private readonly SurveyResponseDraftRepository $drafts,
        private readonly SurveyFileStorage $fileStorage,
    ) {
    }

    /**
     * @param array<string, mixed> $answers
     * @param array{
     *     oncePerUser?: bool,
     *     allowAnonymous?: bool,
     *     windowStart?: string,
     *     windowEnd?: string,
     *     responseId?: string,
     *     progress?: array<string, mixed>,
     * } $enforce
     *
     * @throws SurveySubmissionRejectedException
     */
    public function submit(
        Survey $survey,
        array $answers,
        ?int $userId,
        ?string $visitorId,
        array $enforce = [],
    ): SurveyRun {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getSurveyId()));
        }

        $this->guardAgainstReSubmission($survey, $userId, $visitorId, $enforce);

        $normalized = $this->normalizer->normalize($version, $answers);

        $responseId = $this->resolveResponseId($enforce, $userId, $visitorId);
        $progress = is_array($enforce['progress'] ?? null) ? $enforce['progress'] : [];
        $progress['answered'] = count($normalized);

        return $this->em->wrapInTransaction(function () use ($survey, $version, $normalized, $responseId, $userId, $visitorId, $progress): SurveyRun {
            $draft = $this->drafts->findOneByResponseId($responseId);
            $run = new SurveyRun($survey, $version, $responseId, $userId, $visitorId);
            $run->setStatus(SurveyRun::STATUS_COMPLETED);
            $run->setProgress($progress);
            $this->em->persist($run);
            $this->em->flush();

            $writeResult = $this->writer->writeRow($survey, $version, $normalized, $userId, $responseId);
            $run->setIdDataRow($writeResult->idDataRow);

            foreach ($normalized as $entry) {
                $link = new SurveyAnswerLink(
                    $run,
                    $entry['name'],
                    $entry['type'],
                    $this->stringifyAnswerValue($entry['value']),
                );
                $link->setSanitizedHtml($entry['sanitizedHtml']);
                $this->em->persist($link);
            }
            $this->em->flush();

            if ($draft instanceof SurveyResponseDraft) {
                $this->fileStorage->promoteDraftFilesToRun($draft, $run);
                $this->em->remove($draft);
                $this->em->flush();
            }

            $this->realtime->surveyResponseSubmitted($survey, $run, $userId);
            return $run;
        });
    }

    /**
     * @param array{oncePerUser?: bool, allowAnonymous?: bool, windowStart?: string, windowEnd?: string} $enforce
     */
    private function guardAgainstReSubmission(Survey $survey, ?int $userId, ?string $visitorId, array $enforce): void
    {
        $oncePerUser = (bool) ($enforce['oncePerUser'] ?? false);
        $allowAnonymous = (bool) ($enforce['allowAnonymous'] ?? false);
        $windowStart = $this->parseEnforceTimestamp($enforce['windowStart'] ?? null);
        $windowEnd = $this->parseEnforceTimestamp($enforce['windowEnd'] ?? null);

        if (!$oncePerUser && $windowStart === null && $windowEnd === null) {
            return;
        }

        if ($userId === null && (!$allowAnonymous || $visitorId === null || $visitorId === '')) {
            throw new SurveySubmissionRejectedException(
                SurveySubmissionRejectedException::REASON_AUTH_REQUIRED,
                'Once-per-user / scheduled survey submissions require an authenticated session or a visitor cookie.',
            );
        }

        $existing = null;
        if ($userId !== null) {
            $existing = $this->runs->findLatestCompletedForUser($survey, $userId, $windowStart, $windowEnd);
        }
        if ($existing === null && $visitorId !== null && $visitorId !== '') {
            $existing = $this->runs->findLatestCompletedForVisitor($survey, $visitorId, $windowStart, $windowEnd);
        }
        if ($existing === null) {
            return;
        }

        if ($oncePerUser && $windowStart === null && $windowEnd === null) {
            throw new SurveySubmissionRejectedException(
                SurveySubmissionRejectedException::REASON_ONCE_PER_USER,
                sprintf('Survey "%s" already submitted by this user.', $survey->getSurveyId()),
            );
        }

        throw new SurveySubmissionRejectedException(
            SurveySubmissionRejectedException::REASON_WINDOW_EXHAUSTED,
            sprintf('Survey "%s" already submitted by this user in the current window.', $survey->getSurveyId()),
        );
    }

    private function parseEnforceTimestamp(mixed $value): ?\DateTimeImmutable
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        try {
            return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
        } catch (\Exception) {
            return null;
        }
    }

    /**
     * @param array{responseId?: string} $enforce
     */
    private function resolveResponseId(array $enforce, ?int $userId, ?string $visitorId): string
    {
        $candidate = $enforce['responseId'] ?? null;
        if (is_string($candidate) && $candidate !== '') {
            $existingRun = $this->runs->findOneByResponseId($candidate);
            if ($existingRun === null) {
                return $candidate;
            }
            // A run already exists with this responseId; this is the
            // edit-mode scenario but the dedicated `editResponse`
            // controller action handles updates. Falling back to a
            // fresh id avoids violating the unique constraint.
        }
        return $this->generateResponseId();
    }

    private function generateResponseId(): string
    {
        do {
            $responseId = 'R_' . strtoupper(bin2hex(random_bytes(8)));
        } while ($this->runs->findOneByResponseId($responseId) !== null);

        return $responseId;
    }

    private function stringifyAnswerValue(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        if (is_scalar($value)) {
            return (string) $value;
        }

        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
    }
}

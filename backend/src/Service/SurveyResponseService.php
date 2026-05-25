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
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * Submission flow.
 *
 * Receives the SurveyJS answer JSON from the public submission
 * endpoint, normalizes + sanitizes it, persists `survey_runs` /
 * `survey_answer_links` metadata, and emits the realtime event the
 * Responses dashboard listens to. The actual answer values land in
 * the host `data_tables` / `data_rows` / `data_cells` via the
 * `DataTableWriterInterface` injected by the host (decoupled so the
 * plugin does not import core CMS internals directly).
 */
final class SurveyResponseService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyAnswerNormalizer $normalizer,
        private readonly SurveyJsRealtimePublisher $realtime,
        private readonly DataTableWriterInterface $writer,
        private readonly SurveyRunRepository $runs,
    ) {
    }

    /**
     * @param array<string, mixed> $answers
     * @param array{
     *     oncePerUser?: bool,
     *     windowStart?: string,
     *     windowEnd?: string,
     * } $enforce
     *
     * The `enforce` block lets the section runtime ask the server to
     * apply its `once_per_user` / `once_per_schedule` flags so a client
     * cannot bypass them by hitting the public submit endpoint
     * directly. When `oncePerUser=true` or a window is supplied,
     * anonymous submissions are rejected (we have no stable identity
     * to deduplicate against). Window timestamps must be ISO 8601 and
     * are interpreted as UTC.
     *
     * @throws SurveySubmissionRejectedException when a server-side guard rejects the submission.
     */
    public function submit(Survey $survey, array $answers, ?int $userId, array $enforce = []): SurveyRun
    {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getSurveyId()));
        }

        $this->guardAgainstReSubmission($survey, $userId, $enforce);

        $normalized = $this->normalizer->normalize($version, $answers);

        $responseId = $this->generateResponseId();

        return $this->em->wrapInTransaction(function () use ($survey, $version, $normalized, $responseId, $userId): SurveyRun {
            $run = new SurveyRun($survey, $version, $responseId, $userId);
            $run->setStatus(SurveyRun::STATUS_COMPLETED);
            $run->setProgress(['answered' => count($normalized)]);
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

            $this->realtime->surveyResponseSubmitted($survey, $run, $userId);
            return $run;
        });
    }

    /**
     * @param array{oncePerUser?: bool, windowStart?: string, windowEnd?: string} $enforce
     */
    private function guardAgainstReSubmission(Survey $survey, ?int $userId, array $enforce): void
    {
        $oncePerUser = (bool) ($enforce['oncePerUser'] ?? false);
        $windowStart = $this->parseEnforceTimestamp($enforce['windowStart'] ?? null);
        $windowEnd = $this->parseEnforceTimestamp($enforce['windowEnd'] ?? null);

        if (!$oncePerUser && $windowStart === null && $windowEnd === null) {
            return;
        }

        if ($userId === null) {
            // No stable identity → we cannot dedupe anonymous re-submissions.
            // The runtime is expected to require authentication when these
            // flags are on; the server-side guard surfaces the same error
            // explicitly instead of silently letting the row through.
            throw new SurveySubmissionRejectedException(
                SurveySubmissionRejectedException::REASON_AUTH_REQUIRED,
                'Once-per-user / scheduled survey submissions require an authenticated session.',
            );
        }

        $existing = $this->runs->findLatestCompletedForUser($survey, $userId, $windowStart, $windowEnd);
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
            // Invalid datetime in `enforce.windowStart` / `enforce.windowEnd`
            // is treated as "no window passed" rather than a hard error so a
            // misconfigured section cannot turn into a 5xx for the respondent.
            return null;
        }
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

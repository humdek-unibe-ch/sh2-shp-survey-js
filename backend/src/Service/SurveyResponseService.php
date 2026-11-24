<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;

/**
 * Submission flow: normalizes the SurveyJS answers, checks the once-per-user
 * and schedule limits, and saves the response as `finished` in the survey's
 * data table ({@see SurveyResponseStore}). A response saved as progress
 * before (same response id, same participant) becomes the finished one, so a
 * response is always one row.
 */
final class SurveyResponseService
{
    public function __construct(
        private readonly SurveyAnswerNormalizer $normalizer,
        private readonly SurveyJsRealtimePublisher $realtime,
        private readonly SurveyResponseStore $responses,
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
     *     editMode?: bool,
     *     progress?: array<string, mixed>,
     * } $enforce
     * @param array{0: string, 1: string}|null $rowKey column and value that name the row (`update_based_on`, `auto_session_key`)
     *
     * @throws SurveySubmissionRejectedException
     */
    public function submit(
        Survey $survey,
        array $answers,
        ?int $userId,
        ?string $guestKey,
        array $enforce = [],
        ?string $language = null,
        ?array $rowKey = null,
    ): SurveyResponseRecord {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getSurveyId()));
        }
        $progress = is_array($enforce['progress'] ?? null) ? $enforce['progress'] : [];
        $pageNo = is_int($progress['pageNo'] ?? null) ? $progress['pageNo'] : 0;
        $candidate = is_string($enforce['responseId'] ?? null) && $enforce['responseId'] !== '' ? $enforce['responseId'] : null;
        $known = $candidate !== null ? $this->responses->findByResponseId($survey, $candidate) : null;

        if ((bool) ($enforce['editMode'] ?? false)) {
            // Editing a submitted response: it must exist and be the caller's.
            // The limits do not apply; owning a finished response is the
            // precondition for editing it.
            if ($known === null || !$known->isFinished()) {
                throw new SurveySubmissionRejectedException(
                    SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND,
                    sprintf('No submitted response "%s" to edit.', (string) $candidate),
                );
            }
            if (!$known->belongsTo($userId, $guestKey)) {
                throw new SurveySubmissionRejectedException(
                    SurveySubmissionRejectedException::REASON_EDIT_FORBIDDEN,
                    'You do not own the response being edited.',
                );
            }
            $existing = $known;
            $responseId = $known->responseId;
        } else {
            $this->guardAgainstReSubmission($survey, $userId, $guestKey, $enforce);
            // Only the caller's own unfinished response is completed; any other
            // known id (finished, or someone else's) gets a fresh response. With
            // a row key it is the unfinished row holding that key.
            $existing = $rowKey !== null
                ? $this->responses->findUnfinishedByCell($survey, $rowKey[0], $rowKey[1])
                : ($known !== null && !$known->isFinished() && $known->belongsTo($userId, $guestKey) ? $known : null);
            $responseId = $existing->responseId ?? ($known === null && $candidate !== null ? $candidate : $this->generateResponseId($survey));
        }

        $record = $this->responses->save(
            $survey,
            $version,
            $this->normalizer->normalize($version, $answers),
            $responseId,
            SurveyResponseStore::guestKeyToStore($userId, $guestKey),
            $language ?? $existing?->language,
            $pageNo,
            true,
            $existing,
            $userId,
            $rowKey,
        );
        $this->realtime->surveyResponseSubmitted($survey, $record, $userId);

        return $record;
    }

    /**
     * @param array{oncePerUser?: bool, allowAnonymous?: bool, windowStart?: string, windowEnd?: string} $enforce
     */
    private function guardAgainstReSubmission(Survey $survey, ?int $userId, ?string $guestKey, array $enforce): void
    {
        $oncePerUser = (bool) ($enforce['oncePerUser'] ?? false);
        $allowAnonymous = (bool) ($enforce['allowAnonymous'] ?? false);
        $windowStart = $this->parseEnforceTimestamp($enforce['windowStart'] ?? null);
        $windowEnd = $this->parseEnforceTimestamp($enforce['windowEnd'] ?? null);

        if (!$oncePerUser && $windowStart === null && $windowEnd === null) {
            return;
        }

        if ($userId === null && (!$allowAnonymous || $guestKey === null || $guestKey === '')) {
            throw new SurveySubmissionRejectedException(
                SurveySubmissionRejectedException::REASON_AUTH_REQUIRED,
                'Once-per-user / scheduled survey submissions require an authenticated session or a visitor cookie.',
            );
        }

        $existing = $this->responses->findLatestFinished($survey, $userId, $guestKey, $windowStart, $windowEnd);
        if ($existing === null && $userId !== null) {
            // A response sent as a guest before signing in counts too.
            $existing = $this->responses->findLatestFinished($survey, null, $guestKey, $windowStart, $windowEnd);
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

    public function generateResponseId(Survey $survey): string
    {
        do {
            $responseId = 'R_' . strtoupper(bin2hex(random_bytes(8)));
        } while ($this->responses->findByResponseId($survey, $responseId) !== null);

        return $responseId;
    }
}

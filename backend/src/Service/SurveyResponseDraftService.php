<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;

/**
 * Progress of a survey not yet submitted, so a participant can leave and come
 * back (on this or another device). Progress is the response's own row in the
 * survey's data table with trigger `started` or `updated`, the page reached
 * and the language; submitting turns the same row `finished`
 * ({@see SurveyResponseService}). There is no separate draft copy and no
 * expiry: an abandoned response stays as an unfinished row the admin sees.
 */
final class SurveyResponseDraftService
{
    public function __construct(
        private readonly SurveyAnswerNormalizer $normalizer,
        private readonly SurveyResponseStore $responses,
        private readonly SurveyResponseService $submissions,
    ) {
    }

    /**
     * Saves the answers so far. A submitted response is never turned back to
     * unfinished: progress sent for it (an edit in progress) is ignored.
     *
     * @param array<string, mixed> $answers
     *
     * @throws \DomainException when the response id belongs to someone else
     */
    public function save(
        Survey $survey,
        ?string $responseId,
        ?int $userId,
        ?string $guestKey,
        array $answers,
        int $pageNo,
        ?string $language,
    ): SurveyResponseRecord {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getSurveyId()));
        }

        $existing = $responseId !== null && $responseId !== ''
            ? $this->responses->findByResponseId($survey, $responseId)
            : null;
        if ($existing !== null) {
            if (!$existing->belongsTo($userId, $guestKey)) {
                throw new \DomainException('This response belongs to someone else.');
            }
            if ($existing->isFinished()) {
                return $existing;
            }
        }

        return $this->responses->save(
            $survey,
            $version,
            $this->normalizer->normalize($version, $answers),
            $existing->responseId ?? ($responseId !== null && $responseId !== '' ? $responseId : $this->submissions->generateResponseId($survey)),
            SurveyResponseStore::guestKeyToStore($userId, $guestKey, $existing),
            $language ?? $existing?->language,
            // A slower autosave must not move the participant back a page.
            max($pageNo, $existing->pageNo ?? 0),
            false,
            $existing,
            $userId,
        );
    }

    /**
     * The participant's unfinished response: the named one if it is theirs,
     * else their latest. A signed-in participant also gets back what they
     * started as a guest on this browser.
     */
    public function resume(Survey $survey, ?int $userId, ?string $guestKey, ?string $responseId): ?SurveyResponseRecord
    {
        if ($responseId !== null && $responseId !== '') {
            $record = $this->responses->findByResponseId($survey, $responseId);

            return $record !== null && !$record->isFinished() && $record->belongsTo($userId, $guestKey) ? $record : null;
        }

        $record = $this->responses->findUnfinished($survey, $userId, $guestKey);
        if ($record === null && $userId !== null) {
            $record = $this->responses->findUnfinished($survey, null, $guestKey);
        }

        return $record;
    }

    /** Throws the unfinished response away (core soft delete, trigger `deleted`). */
    public function discard(Survey $survey, SurveyResponseRecord $record): void
    {
        $this->responses->delete($survey, $record);
    }
}

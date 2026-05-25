<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use DateTimeImmutable;
use DateTimeZone;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * In-progress survey state management.
 *
 * The legacy plugin auto-saved each page change to the host
 * `user_input` table. We keep the same UX (so participants can refresh
 * without losing data) but isolate the partial payload from the
 * canonical `survey_runs` rows so:
 *
 *   - the dashboard never shows half-filled responses,
 *   - the once-per-user guard sees the finished run only after
 *     submission completes,
 *   - draft TTL evicts abandoned attempts.
 *
 * The default TTL is 30 days, matching the proposal in the plan's
 * "remaining minor confirmations" section.
 */
final class SurveyResponseDraftService
{
    private const DEFAULT_TTL_DAYS = 30;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyResponseDraftRepository $drafts,
        private readonly SurveyRunRepository $runs,
    ) {
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function saveOrCreate(
        Survey $survey,
        ?string $responseId,
        ?int $userId,
        ?string $visitorId,
        array $payload,
        int $pageNo,
    ): SurveyResponseDraft {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getSurveyId()));
        }

        $draft = $responseId !== null && $responseId !== ''
            ? $this->drafts->findOneByResponseId($responseId)
            : null;

        if ($draft instanceof SurveyResponseDraft) {
            if ($draft->getSurvey()->getId() !== $survey->getId()) {
                throw new \DomainException('Draft does not belong to this survey.');
            }
            // Optimistic-concurrency style: keep the highest page_no
            // seen so a slower autosave does not rewind progress.
            $draft->setPayload($payload);
            if ($pageNo > $draft->getPageNo()) {
                $draft->setPageNo($pageNo);
            }
            $draft->extendExpiry($this->defaultExpiry());
            $this->em->flush();
            return $draft;
        }

        $newResponseId = $responseId !== null && $responseId !== ''
            ? $responseId
            : $this->generateResponseId();
        $draft = new SurveyResponseDraft(
            $survey,
            $version,
            $newResponseId,
            $userId,
            $visitorId,
            $payload,
            max(0, $pageNo),
            $this->defaultExpiry(),
        );
        $this->em->persist($draft);
        $this->em->flush();
        return $draft;
    }

    public function resume(Survey $survey, ?int $userId, ?string $visitorId, ?string $responseId): ?SurveyResponseDraft
    {
        if ($responseId !== null && $responseId !== '') {
            $draft = $this->drafts->findOneByResponseId($responseId);
            if ($draft instanceof SurveyResponseDraft
                && $draft->getSurvey()->getId() === $survey->getId()
                && $this->draftBelongsTo($draft, $userId, $visitorId)
            ) {
                return $draft;
            }
            return null;
        }

        if ($userId !== null) {
            return $this->drafts->findLatestForUser($survey, $userId);
        }
        if ($visitorId !== null && $visitorId !== '') {
            return $this->drafts->findLatestForVisitor($survey, $visitorId);
        }
        return null;
    }

    public function discard(SurveyResponseDraft $draft): void
    {
        $this->em->remove($draft);
        $this->em->flush();
    }

    public function discardByResponseId(string $responseId): void
    {
        $draft = $this->drafts->findOneByResponseId($responseId);
        if ($draft instanceof SurveyResponseDraft) {
            $this->discard($draft);
        }
    }

    public function purgeExpired(?DateTimeImmutable $now = null): int
    {
        return $this->drafts->purgeExpired($now ?? new DateTimeImmutable('now', new DateTimeZone('UTC')));
    }

    private function defaultExpiry(): DateTimeImmutable
    {
        return (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->modify('+' . self::DEFAULT_TTL_DAYS . ' days');
    }

    private function draftBelongsTo(SurveyResponseDraft $draft, ?int $userId, ?string $visitorId): bool
    {
        if ($userId !== null && $draft->getIdUser() === $userId) {
            return true;
        }
        if ($visitorId !== null && $visitorId !== '' && $draft->getVisitorId() === $visitorId) {
            return true;
        }
        // Drafts saved before the participant logged in carry the
        // visitor id only; we still let an authenticated session
        // claim them when no draft is bound to the user yet.
        if ($userId !== null && $draft->getIdUser() === null && $draft->getVisitorId() !== null && $draft->getVisitorId() === $visitorId) {
            return true;
        }
        return false;
    }

    private function generateResponseId(): string
    {
        do {
            $candidate = 'R_' . strtoupper(bin2hex(random_bytes(8)));
        } while (
            $this->drafts->findOneByResponseId($candidate) !== null
            || $this->runs->findOneByResponseId($candidate) !== null
        );
        return $candidate;
    }
}

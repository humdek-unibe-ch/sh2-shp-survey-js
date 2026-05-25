<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Repository;

use DateTimeImmutable;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;

/**
 * @extends ServiceEntityRepository<SurveyResponseDraft>
 */
class SurveyResponseDraftRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SurveyResponseDraft::class);
    }

    public function findOneByResponseId(string $responseId): ?SurveyResponseDraft
    {
        return $this->findOneBy(['responseId' => $responseId]);
    }

    /**
     * Latest draft for an authenticated user. Used by the runtime to
     * resume an in-progress survey when `?responseId=` is missing.
     */
    public function findLatestForUser(Survey $survey, int $userId): ?SurveyResponseDraft
    {
        return $this->createQueryBuilder('d')
            ->andWhere('d.survey = :survey')
            ->andWhere('d.idUser = :userId')
            ->setParameter('survey', $survey)
            ->setParameter('userId', $userId)
            ->orderBy('d.lastSavedAt', 'DESC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /** Same as {@see findLatestForUser} for anonymous (visitor-cookie) drafts. */
    public function findLatestForVisitor(Survey $survey, string $visitorId): ?SurveyResponseDraft
    {
        return $this->createQueryBuilder('d')
            ->andWhere('d.survey = :survey')
            ->andWhere('d.visitorId = :visitorId')
            ->setParameter('survey', $survey)
            ->setParameter('visitorId', $visitorId)
            ->orderBy('d.lastSavedAt', 'DESC')
            ->setMaxResults(1)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /**
     * Remove expired drafts. Called by the cleanup command or
     * opportunistically when a fresh draft is created.
     */
    public function purgeExpired(DateTimeImmutable $now): int
    {
        return (int) $this->createQueryBuilder('d')
            ->delete()
            ->andWhere('d.expiresAt < :now')
            ->setParameter('now', $now)
            ->getQuery()
            ->execute();
    }
}

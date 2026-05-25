<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Repository;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyRun;

/**
 * @extends ServiceEntityRepository<SurveyRun>
 */
final class SurveyRunRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SurveyRun::class);
    }

    /** @return SurveyRun[] */
    public function findRecentForSurvey(Survey $survey, int $limit = 50, int $offset = 0): array
    {
        return $this->createQueryBuilder('r')
            ->andWhere('r.survey = :survey')
            ->setParameter('survey', $survey)
            ->orderBy('r.startedAt', 'DESC')
            ->setMaxResults($limit)
            ->setFirstResult($offset)
            ->getQuery()
            ->getResult();
    }

    /**
     * Total number of runs for the survey, regardless of status. Used
     * by the admin Responses tab to paginate over in-progress, completed,
     * and invalid runs in one view.
     */
    public function countForSurvey(Survey $survey): int
    {
        return (int) $this->createQueryBuilder('r')
            ->select('COUNT(r.id)')
            ->andWhere('r.survey = :survey')
            ->setParameter('survey', $survey)
            ->getQuery()
            ->getSingleScalarResult();
    }

    public function countCompletedForSurvey(Survey $survey): int
    {
        return (int) $this->createQueryBuilder('r')
            ->select('COUNT(r.id)')
            ->andWhere('r.survey = :survey')
            ->andWhere('r.status = :status')
            ->setParameter('survey', $survey)
            ->setParameter('status', SurveyRun::STATUS_COMPLETED)
            ->getQuery()
            ->getSingleScalarResult();
    }

    public function findOneByResponseId(string $responseId): ?SurveyRun
    {
        return $this->findOneBy(['responseId' => $responseId]);
    }

    /**
     * Returns the most recent completed run a given user submitted for
     * the given survey, optionally restricted to a window. Used by
     * {@see \Humdek\SurveyJsBundle\Service\SurveyResponseService::submit()}
     * to enforce the `once_per_user` / `once_per_schedule` flags
     * server-side (the runtime also honours them, but a client could
     * skip them by hitting the public endpoint directly).
     *
     * The window is matched against `completed_at` so unfinished /
     * invalid runs do not block a fresh submission. When both bounds
     * are null the query is "ever completed".
     */
    public function findLatestCompletedForUser(
        Survey $survey,
        int $userId,
        ?\DateTimeImmutable $windowStart = null,
        ?\DateTimeImmutable $windowEnd = null,
    ): ?SurveyRun {
        $qb = $this->createQueryBuilder('r')
            ->andWhere('r.survey = :survey')
            ->andWhere('r.idUser = :userId')
            ->andWhere('r.status = :status')
            ->setParameter('survey', $survey)
            ->setParameter('userId', $userId)
            ->setParameter('status', SurveyRun::STATUS_COMPLETED)
            ->orderBy('r.completedAt', 'DESC')
            ->setMaxResults(1);

        if ($windowStart !== null) {
            $qb->andWhere('r.completedAt >= :windowStart')->setParameter('windowStart', $windowStart);
        }
        if ($windowEnd !== null) {
            $qb->andWhere('r.completedAt <= :windowEnd')->setParameter('windowEnd', $windowEnd);
        }

        $result = $qb->getQuery()->getOneOrNullResult();
        return $result instanceof SurveyRun ? $result : null;
    }
}

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
class SurveyRunRepository extends ServiceEntityRepository
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

    /**
     * Anonymous-user variant of {@see findLatestCompletedForUser}. The
     * `visitor_id` comes from the signed `_sh_sjs_vid` cookie and is
     * stable enough to dedupe repeated submissions from the same
     * browser/profile (but easily defeatable by clearing cookies — see
     * the plugin's "Anonymous + once-per-user" risk note).
     */
    public function findLatestCompletedForVisitor(
        Survey $survey,
        string $visitorId,
        ?\DateTimeImmutable $windowStart = null,
        ?\DateTimeImmutable $windowEnd = null,
    ): ?SurveyRun {
        $qb = $this->createQueryBuilder('r')
            ->andWhere('r.survey = :survey')
            ->andWhere('r.visitorId = :visitorId')
            ->andWhere('r.status = :status')
            ->setParameter('survey', $survey)
            ->setParameter('visitorId', $visitorId)
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

    /**
     * Returns the most recent completed run for a given user so the
     * runtime's "edit-mode" (`?record_id=`) flow can hydrate the form.
     * Honours `own_entries_only` because it only considers rows the
     * caller owns.
     */
    public function findCompletedOwnedRun(Survey $survey, ?int $userId, ?string $visitorId, ?string $responseId = null): ?SurveyRun
    {
        if ($userId === null && ($visitorId === null || $visitorId === '')) {
            return null;
        }

        $qb = $this->createQueryBuilder('r')
            ->andWhere('r.survey = :survey')
            ->andWhere('r.status = :status')
            ->setParameter('survey', $survey)
            ->setParameter('status', SurveyRun::STATUS_COMPLETED)
            ->orderBy('r.completedAt', 'DESC')
            ->setMaxResults(1);

        if ($responseId !== null && $responseId !== '') {
            $qb->andWhere('r.responseId = :responseId')->setParameter('responseId', $responseId);
        }

        if ($userId !== null && $visitorId !== null && $visitorId !== '') {
            $qb->andWhere('r.idUser = :userId OR r.visitorId = :visitorId')
                ->setParameter('userId', $userId)
                ->setParameter('visitorId', $visitorId);
        } elseif ($userId !== null) {
            $qb->andWhere('r.idUser = :userId')->setParameter('userId', $userId);
        } else {
            $qb->andWhere('r.visitorId = :visitorId')->setParameter('visitorId', $visitorId);
        }

        $result = $qb->getQuery()->getOneOrNullResult();
        return $result instanceof SurveyRun ? $result : null;
    }
}

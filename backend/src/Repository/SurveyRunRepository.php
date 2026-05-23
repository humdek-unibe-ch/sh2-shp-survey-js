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
}

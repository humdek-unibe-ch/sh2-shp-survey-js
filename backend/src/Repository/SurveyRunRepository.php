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
    public function findRecentForSurvey(Survey $survey, int $limit = 50): array
    {
        return $this->createQueryBuilder('r')
            ->andWhere('r.survey = :survey')
            ->setParameter('survey', $survey)
            ->orderBy('r.startedAt', 'DESC')
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
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

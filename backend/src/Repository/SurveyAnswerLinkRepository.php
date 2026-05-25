<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Repository;

use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;

/**
 * @extends ServiceEntityRepository<SurveyAnswerLink>
 */
class SurveyAnswerLinkRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SurveyAnswerLink::class);
    }

    /** @return SurveyAnswerLink[] */
    public function findForRun(SurveyRun $run): array
    {
        return $this->createQueryBuilder('a')
            ->andWhere('a.run = :run')
            ->setParameter('run', $run)
            ->orderBy('a.questionName', 'ASC')
            ->getQuery()
            ->getResult();
    }
}

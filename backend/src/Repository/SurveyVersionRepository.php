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
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * @extends ServiceEntityRepository<SurveyVersion>
 */
final class SurveyVersionRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SurveyVersion::class);
    }

    public function nextRevision(Survey $survey): int
    {
        $row = $this->createQueryBuilder('v')
            ->select('MAX(v.revision) AS maxRevision')
            ->andWhere('v.survey = :survey')
            ->setParameter('survey', $survey)
            ->getQuery()
            ->getOneOrNullResult();
        $max = (int) ($row['maxRevision'] ?? 0);
        return $max + 1;
    }
}

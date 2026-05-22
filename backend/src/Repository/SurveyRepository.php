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

/**
 * @extends ServiceEntityRepository<Survey>
 */
final class SurveyRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Survey::class);
    }

    public function findOneByKeySlug(string $keySlug): ?Survey
    {
        return $this->findOneBy(['keySlug' => $keySlug]);
    }

    /** @return Survey[] */
    public function findAllActive(): array
    {
        return $this->createQueryBuilder('s')
            ->andWhere('s.archived = false')
            ->orderBy('s.updatedAt', 'DESC')
            ->getQuery()
            ->getResult();
    }
}

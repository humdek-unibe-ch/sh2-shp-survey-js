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
use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;
use Humdek\SurveyJsBundle\Entity\SurveyRun;

/**
 * @extends ServiceEntityRepository<SurveyFile>
 */
final class SurveyFileRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, SurveyFile::class);
    }

    /** @return SurveyFile[] */
    public function findByResponseId(string $responseId): array
    {
        return $this->findBy(['responseId' => $responseId]);
    }

    /** @return SurveyFile[] */
    public function findByDraft(SurveyResponseDraft $draft): array
    {
        return $this->findBy(['draft' => $draft]);
    }

    /** @return SurveyFile[] */
    public function findByRun(SurveyRun $run): array
    {
        return $this->findBy(['run' => $run]);
    }

    public function findOneByResponseAndQuestion(string $responseId, string $questionName, string $sha256): ?SurveyFile
    {
        return $this->findOneBy([
            'responseId' => $responseId,
            'questionName' => $questionName,
            'sha256' => $sha256,
        ]);
    }

    public function countForSurvey(Survey $survey): int
    {
        return (int) $this->createQueryBuilder('f')
            ->select('COUNT(f.id)')
            ->andWhere('f.survey = :survey')
            ->setParameter('survey', $survey)
            ->getQuery()
            ->getSingleScalarResult();
    }
}

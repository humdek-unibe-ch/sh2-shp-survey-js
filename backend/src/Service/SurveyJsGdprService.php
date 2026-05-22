<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\SurveyRun;

/**
 * GDPR data export / cleanup hooks. The host invokes these through
 * tagged service interfaces (`PluginDataExportInterface`,
 * `PluginDataCleanupInterface`).
 *
 * The plugin only owns the metadata rows (`survey_runs`,
 * `survey_answer_links`). Actual answer values stored in `data_cells`
 * are exported / deleted by the core GDPR pipeline, which uses our
 * `survey_answer_links.id_data_cells` mappings to find them.
 */
final class SurveyJsGdprService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
    ) {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function exportForUser(int $userId): array
    {
        $runs = $this->em->getRepository(SurveyRun::class)->findBy(['idUser' => $userId]);
        $out = [];
        foreach ($runs as $run) {
            $out[] = [
                'runId' => $run->getId(),
                'surveyId' => $run->getSurvey()->getId(),
                'surveyName' => $run->getSurvey()->getName(),
                'revision' => $run->getVersion()->getRevision(),
                'status' => $run->getStatus(),
                'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
                'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                'idDataRow' => $run->getIdDataRow(),
            ];
        }
        return $out;
    }

    public function deleteForUser(int $userId): int
    {
        return $this->em->wrapInTransaction(function () use ($userId): int {
            $runs = $this->em->getRepository(SurveyRun::class)->findBy(['idUser' => $userId]);
            $count = 0;
            foreach ($runs as $run) {
                $this->em->remove($run);
                $count++;
            }
            $this->em->flush();
            return $count;
        });
    }
}

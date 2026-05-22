<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;

/**
 * Submission flow.
 *
 * Receives the SurveyJS answer JSON from the public submission
 * endpoint, normalizes + sanitizes it, persists `survey_runs` /
 * `survey_answer_links` metadata, and emits the realtime event the
 * Responses dashboard listens to. The actual answer values land in
 * the host `data_tables` / `data_rows` / `data_cells` via the
 * `DataTableWriterInterface` injected by the host (decoupled so the
 * plugin does not import core CMS internals directly).
 */
final class SurveyResponseService
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyAnswerNormalizer $normalizer,
        private readonly SurveyJsRealtimePublisher $realtime,
        private readonly DataTableWriterInterface $writer,
    ) {
    }

    /**
     * @param array<string, mixed> $answers
     */
    public function submit(Survey $survey, array $answers, ?int $userId): SurveyRun
    {
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            throw new \DomainException(sprintf('Survey "%s" has no published version.', $survey->getKeySlug()));
        }
        $normalized = $this->normalizer->normalize($version, $answers);

        return $this->em->wrapInTransaction(function () use ($survey, $version, $normalized, $userId): SurveyRun {
            $run = new SurveyRun($survey, $version, $userId);
            $run->setStatus(SurveyRun::STATUS_COMPLETED);
            $run->setProgress(['answered' => count($normalized)]);
            $this->em->persist($run);
            $this->em->flush();

            $writeResult = $this->writer->writeRow($survey, $version, $normalized, $userId);
            $run->setIdDataRow($writeResult->idDataRow);

            foreach ($normalized as $entry) {
                $link = new SurveyAnswerLink($run, $entry['name'], $entry['type']);
                $link->setSanitizedHtml($entry['sanitizedHtml']);
                $link->setIdDataCell($writeResult->idDataCellByName[$entry['name']] ?? null);
                $this->em->persist($link);
            }

            $this->em->flush();

            $this->realtime->surveyResponseSubmitted($survey, $run, $userId);
            return $run;
        });
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * Aggregations the dashboard view consumes (totals + per-question
 * histograms). Heavy aggregations live in the host's existing form
 * analytics service; this service only produces lightweight summaries
 * so the admin Dashboard tab can render without polling.
 */
final class SurveyDashboardService
{
    public function __construct(
        private readonly SurveyRunRepository $runs,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function buildSummary(Survey $survey): array
    {
        return [
            'id' => $survey->getId(),
            'surveyId' => $survey->getSurveyId(),
            'completedResponses' => $this->runs->countCompletedForSurvey($survey),
            'recent' => array_map(
                static fn ($run) => [
                    'id' => $run->getId(),
                    'responseId' => $run->getResponseId(),
                    'status' => $run->getStatus(),
                    'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
                    'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                    'idDataRow' => $run->getIdDataRow(),
                ],
                $this->runs->findRecentForSurvey($survey, 10),
            ),
            'currentVersionRevision' => $survey->getCurrentVersion()?->getRevision(),
        ];
    }
}

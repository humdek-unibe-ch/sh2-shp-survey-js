<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;

/**
 * What the admin Answers tab shows: totals (summary) and the finished
 * responses as flat rows for the SurveyJS charts (results). Everything is
 * read from the survey's data table through {@see SurveyResponseStore}; the
 * list of responses is the core data screen's.
 */
final class SurveyDashboardService
{
    public function __construct(
        private readonly SurveyResponseStore $responses,
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
            'completedResponses' => $this->responses->list($survey, 0, 1, true)['total'],
            'totalResponses' => $this->responses->list($survey, 0, 1)['total'],
            'currentVersionRevision' => $survey->getCurrentVersion()?->getRevision(),
        ];
    }

    /**
     * Finished responses as flat rows (meta columns plus one key per
     * question), newest first, with the current definition for the charts.
     *
     * @return array{
     *     surveyId: string,
     *     definition: array<string, mixed>,
     *     rows: list<array<string, mixed>>,
     * }
     */
    public function buildResults(Survey $survey, int $limit = 5000): array
    {
        $rows = [];
        foreach ($this->responses->eachFinished($survey) as $record) {
            if (count($rows) >= $limit) {
                break;
            }
            $rows[] = [...$record->metaColumns(), ...$record->answers];
        }

        return [
            'surveyId' => $survey->getSurveyId(),
            'definition' => $survey->getCurrentVersion()?->getDefinition() ?? ['pages' => []],
            'rows' => $rows,
        ];
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * Aggregations the dashboard view consumes (totals + per-question
 * histograms) plus the flattened response feed for the
 * Tabulator-based admin table.
 *
 * Heavy aggregations live in the host's existing form analytics
 * service; this service only produces lightweight summaries so the
 * admin Dashboard tab can render without polling.
 */
final class SurveyDashboardService
{
    public function __construct(
        private readonly SurveyRunRepository $runs,
        private readonly SurveyAnswerLinkRepository $answerLinks,
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
            'totalResponses' => $this->runs->countForSurvey($survey),
            'recent' => array_map(
                static fn (SurveyRun $run) => [
                    'id' => $run->getId(),
                    'responseId' => $run->getResponseId(),
                    'status' => $run->getStatus(),
                    'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
                    'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                    'idDataRow' => $run->getIdDataRow(),
                    'idUser' => $run->getIdUser(),
                    'visitorId' => $run->getVisitorId(),
                ],
                $this->runs->findRecentForSurvey($survey, 10),
            ),
            'currentVersionRevision' => $survey->getCurrentVersion()?->getRevision(),
        ];
    }

    /**
     * Flat result payload used by the SurveyAnalyticsTabulator-based
     * admin table. The shape matches what the SurveyAnalytics package
     * expects: each row is a flat associative array keyed by
     * question name + the internal meta columns.
     *
     * @return array{
     *     surveyId: string,
     *     definition: array<string, mixed>,
     *     rows: list<array<string, mixed>>,
     * }
     */
    public function buildResults(Survey $survey, int $limit = 5000): array
    {
        $version = $survey->getCurrentVersion();
        $rows = [];
        foreach ($this->runs->findRecentForSurvey($survey, $limit) as $run) {
            $progress = $run->getProgress() ?? [];
            $row = [
                'record_id' => $run->getId(),
                'response_id' => $run->getResponseId(),
                'date' => ($run->getCompletedAt() ?? $run->getStartedAt())->format('Y-m-d H:i:s'),
                'id_users' => $run->getIdUser(),
                'visitor_id' => $run->getVisitorId(),
                'page_no' => isset($progress['pageNo']) && is_int($progress['pageNo']) ? $progress['pageNo'] : 0,
                'trigger_type' => isset($progress['triggerType']) && is_string($progress['triggerType']) ? $progress['triggerType'] : ($run->getStatus() === SurveyRun::STATUS_COMPLETED ? 'finished' : 'updated'),
                'status' => $run->getStatus(),
                'revision' => $run->getVersion()->getRevision(),
            ];
            foreach ($this->answerLinks->findForRun($run) as $link) {
                /** @var SurveyAnswerLink $link */
                $row[$link->getQuestionName()] = $this->maybeDecode($link->getAnswerValue());
            }
            $rows[] = $row;
        }

        return [
            'surveyId' => $survey->getSurveyId(),
            'definition' => $version?->getDefinition() ?? ['pages' => []],
            'rows' => $rows,
        ];
    }

    private function maybeDecode(string $value): mixed
    {
        if ($value === '' || ($value[0] !== '{' && $value[0] !== '[')) {
            return $value;
        }
        $decoded = json_decode($value, true);
        return $decoded ?? $value;
    }
}

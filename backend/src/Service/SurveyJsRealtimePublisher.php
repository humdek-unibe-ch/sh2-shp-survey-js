<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * Thin wrapper around the host `PluginRealtimePublisher`.
 *
 * The contract is injected as an interface by the host installer so
 * the plugin never has to import core Mercure code. Topic keys here
 * mirror those declared in `plugin.json` under `realtimeTopics`.
 */
final class SurveyJsRealtimePublisher
{
    public function __construct(
        private readonly PluginRealtimePublisherInterface $host,
    ) {
    }

    private const PLUGIN_ID = 'sh2-shp-survey-js';

    public function surveyVersionPublished(Survey $survey, SurveyVersion $version, ?int $userId): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/editing',
            [
                'type' => 'version_published',
                'surveyId' => $survey->getId(),
                'revision' => $version->getRevision(),
                'publishedByUserId' => $userId,
                'publishedAt' => $version->getCreatedAt()->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => 'version_published',
            ],
        );
    }

    public function surveyEditingPresence(Survey $survey, int $userId, string $userName, string $state): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/editing',
            [
                'type' => 'presence',
                'state' => $state,
                'userId' => $userId,
                'userName' => $userName,
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => 'presence',
            ],
        );
    }

    public function surveyResponseSubmitted(Survey $survey, SurveyRun $run, ?int $userId): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/responses',
            [
                'type' => 'response_submitted',
                'surveyId' => $survey->getId(),
                'runId' => $run->getId(),
                'submittedByUserId' => $userId,
                'submittedAt' => ($run->getCompletedAt() ?? $run->getStartedAt())->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => 'response_submitted',
            ],
        );
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Plugin\Realtime\PluginRealtimePublisherInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * Thin wrapper around the host `PluginRealtimePublisher`.
 *
 * Depends directly on the host contract
 * `App\Plugin\Realtime\PluginRealtimePublisherInterface`. Topic keys
 * mirror those declared in `plugin.json` under `realtimeTopics`.
 */
class SurveyJsRealtimePublisher
{
    public function __construct(
        private readonly PluginRealtimePublisherInterface $host,
    ) {
    }

    private const PLUGIN_ID = 'sh2-shp-survey-js';

    /**
     * The SSE event name `usePluginRealtime` listens for:
     * `plugin/<pluginId>/<topic with its params filled in>`. Any other name
     * reaches the browser but no listener; the payload's `type` tells the
     * events on one topic apart.
     */
    private static function eventName(Survey $survey, string $topic): string
    {
        return 'plugin/' . self::PLUGIN_ID . '/surveys/' . (int) $survey->getId() . '/' . $topic;
    }

    public function surveyVersionPublished(Survey $survey, SurveyVersion $version, ?int $userId): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/editing',
            [
                'type' => 'version_published',
                'id' => $survey->getId(),
                'surveyId' => $survey->getSurveyId(),
                'revision' => $version->getRevision(),
                'publishedByUserId' => $userId,
                'publishedAt' => $version->getCreatedAt()->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => self::eventName($survey, 'editing'),
            ],
        );
    }

    public function surveyDraftSaved(Survey $survey, ?int $userId): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/editing',
            [
                'type' => 'draft_saved',
                'id' => $survey->getId(),
                'surveyId' => $survey->getSurveyId(),
                'draftHash' => $survey->getDraftDefinitionSha256(),
                'savedByUserId' => $userId,
                'savedAt' => $survey->getDraftUpdatedAt()?->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => self::eventName($survey, 'editing'),
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
                'id' => $survey->getId(),
                'surveyId' => $survey->getSurveyId(),
                'state' => $state,
                'userId' => $userId,
                'userName' => $userName,
                'at' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => self::eventName($survey, 'editing'),
            ],
        );
    }

    public function surveyResponseSubmitted(Survey $survey, SurveyResponseRecord $record, ?int $userId): void
    {
        $this->host->publish(
            self::PLUGIN_ID,
            'surveys/{surveyId}/responses',
            [
                'type' => 'response_submitted',
                'id' => $survey->getId(),
                'surveyId' => $survey->getSurveyId(),
                'recordId' => $record->recordId,
                'responseId' => $record->responseId,
                'submittedByUserId' => $userId,
                'submittedAt' => $record->lastChangedAt?->format(DATE_ATOM),
            ],
            [
                'audience' => 'permission',
                'topicParams' => ['surveyId' => (string) $survey->getId()],
                'event' => self::eventName($survey, 'responses'),
            ],
        );
    }
}

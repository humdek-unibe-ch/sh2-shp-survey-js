<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\PluginRealtimePermissionEvent;
use App\Plugin\Realtime\PluginRealtimePublisherInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Grants the survey realtime topics to the user opening the event stream.
 * The host subscribes only to topics a listener grants (deny by default),
 * so without this no survey event reaches the admin screens. The rules are
 * the admin list's: the responses topic for every survey the user sees
 * there, the editing topic for every survey they may edit.
 */
final class SurveyJsRealtimeGrantSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly SurveyRepository $surveys,
        private readonly SurveyAccessService $access,
        private readonly PluginRealtimePublisherInterface $realtime,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            PluginRealtimePermissionEvent::class => 'onRealtimePermission',
        ];
    }

    public function onRealtimePermission(PluginRealtimePermissionEvent $event): void
    {
        if (!$this->access->canOpenAdmin()) {
            return;
        }
        $readable = $this->access->readableSurveyIdsOrNull();
        $visible = array_values(array_filter(
            $this->surveys->findAllNewestFirst(),
            static fn (Survey $survey): bool => $readable === null || in_array((int) $survey->getId(), $readable, true),
        ));
        $rights = $this->access->rightsFor($visible);

        foreach ($visible as $survey) {
            $params = ['surveyId' => (string) $survey->getId()];
            $event->allowTopic($this->realtime->resolveTopicIri(SurveyJsRealtimeTopicSubscriber::PLUGIN_ID, 'surveys/{surveyId}/responses', $params));
            if ($rights[(int) $survey->getId()]['update']) {
                $event->allowTopic($this->realtime->resolveTopicIri(SurveyJsRealtimeTopicSubscriber::PLUGIN_ID, 'surveys/{surveyId}/editing', $params));
            }
        }
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\PluginRealtimeTopicRegistryEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Declares the realtime topics this plugin publishes. The host
 * uses the registry to gate JWT subscriptions per
 * `requiredPermission` and to surface topics in the admin UI.
 */
final class SurveyJsRealtimeTopicSubscriber implements EventSubscriberInterface
{
    public const PLUGIN_ID = 'sh2-shp-survey-js';

    public static function getSubscribedEvents(): array
    {
        return [
            PluginRealtimeTopicRegistryEvent::class => 'onTopicRegistry',
        ];
    }

    public function onTopicRegistry(PluginRealtimeTopicRegistryEvent $event): void
    {
        $event->addTopic(
            pluginId: self::PLUGIN_ID,
            key: 'surveys/{surveyId}/editing',
            description: 'Collaborative-edit presence + save notifications for the Survey Creator.',
            requiredPermission: 'surveyjs.surveys.manage',
        );
        $event->addTopic(
            pluginId: self::PLUGIN_ID,
            key: 'surveys/{surveyId}/responses',
            description: 'Realtime stream of new survey responses. New entries arrive without polling.',
            requiredPermission: 'surveyjs.surveys.view-responses',
        );
    }
}

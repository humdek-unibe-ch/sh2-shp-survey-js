<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\StyleRegistryEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Registers the `surveyjs` runtime style + the `gpxMap` standalone
 * style with the host's StyleRegistryEvent so the admin section
 * builder shows them in the catalog alongside core styles.
 */
final class SurveyJsStyleRegistrySubscriber implements EventSubscriberInterface
{
    public const PLUGIN_ID = 'sh2-shp-survey-js';

    public static function getSubscribedEvents(): array
    {
        return [
            StyleRegistryEvent::class => 'onStyleRegistry',
        ];
    }

    public function onStyleRegistry(StyleRegistryEvent $event): void
    {
        $event->addStyle(
            pluginId: self::PLUGIN_ID,
            name: 'surveyjs',
            description: 'Embeds a published SurveyJS survey at runtime.',
            category: 'forms',
            canHaveChildren: false,
        );
        $event->addStyle(
            pluginId: self::PLUGIN_ID,
            name: 'gpxMap',
            description: 'Standalone Leaflet-based map renderer for a GPX answer field.',
            category: 'media',
            canHaveChildren: false,
        );
    }
}

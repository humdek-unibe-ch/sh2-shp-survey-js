<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\LookupRegistryEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Declares the `surveyJsTheme` lookup as `plugin_owned`. The actual
 * rows are inserted by the plugin's install migration; this
 * subscriber surfaces the contribution at runtime so the admin UI's
 * lookup picker for `surveyJsTheme` can render the choices without a
 * second DB hop.
 */
final class SurveyJsLookupRegistrySubscriber implements EventSubscriberInterface
{
    public const PLUGIN_ID = 'sh2-shp-survey-js';

    public static function getSubscribedEvents(): array
    {
        return [
            LookupRegistryEvent::class => 'onLookupRegistry',
        ];
    }

    public function onLookupRegistry(LookupRegistryEvent $event): void
    {
        $event->addContribution(
            pluginId: self::PLUGIN_ID,
            typeCode: 'surveyJsTheme',
            ownership: 'plugin_owned',
            entries: [
                ['code' => 'default', 'value' => 'Default', 'description' => 'Mantine-bridged default theme.'],
                ['code' => 'modern', 'value' => 'Modern'],
                ['code' => 'high-contrast', 'value' => 'High contrast'],
            ],
        );
    }
}

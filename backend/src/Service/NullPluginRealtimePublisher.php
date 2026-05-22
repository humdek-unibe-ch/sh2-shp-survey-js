<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

/**
 * No-op realtime publisher used in tests / environments without
 * Mercure. The host swaps this for the real one through DI.
 */
final class NullPluginRealtimePublisher implements PluginRealtimePublisherInterface
{
    public function publish(string $pluginId, string $topicKey, array $payload, array $options = []): void
    {
    }
}

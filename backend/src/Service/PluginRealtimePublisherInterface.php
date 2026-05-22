<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

/**
 * Minimal contract the plugin needs from the host realtime layer.
 * The host's `App\Plugin\Realtime\PluginRealtimePublisher` implements
 * a compatible method signature; the wiring lives in
 * `Resources/config/services.php` and falls back to a no-op
 * implementation during tests or when Mercure is not configured.
 */
interface PluginRealtimePublisherInterface
{
    /**
     * Mirrors `App\Plugin\Realtime\PluginRealtimePublisherInterface`.
     * The host's service is wired to this contract through DI; tests
     * use `NullPluginRealtimePublisher`.
     *
     * @param array<string, mixed> $payload
     * @param array{
     *   audience?: 'permission'|'broadcast'|'admins',
     *   topicParams?: array<string, string|int>,
     *   event?: string,
     *   private?: bool,
     * } $options
     */
    public function publish(string $pluginId, string $topicKey, array $payload, array $options = []): void;
}

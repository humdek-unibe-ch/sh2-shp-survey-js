<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

/**
 * PHPStan stubs for host event classes the plugin subscribes to.
 *
 * The runtime classes live in `App\Plugin\Event\*` inside the host
 * (`humdek-unibe-ch/sh-selfhelp_backend`). When PHPStan runs in this
 * plugin repo's CI it does NOT have the host repo on the autoload
 * path, so the imports inside `EventSubscriber/Survey*Subscriber.php`
 * would trip `class.notFound`. The stubs below mirror only the
 * public surface the plugin actually consumes — keep them in sync
 * with `sh-selfhelp_backend/src/Plugin/Event/*.php`.
 *
 * These stubs are loaded by `phpstan.neon.dist` via `bootstrapFiles`,
 * NOT included from any runtime PHP file. They never reach a running
 * Symfony kernel.
 */

namespace App\Plugin\Event {
    if (!\class_exists(LookupRegistryEvent::class, false)) {
        /**
         * Mirrors `App\Plugin\Event\LookupRegistryEvent::addContribution()`.
         */
        final class LookupRegistryEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function getFilterTypeCode(): ?string
            {
                return null;
            }

            /**
             * @param array<int, array{code: string, value: string, description?: string|null}> $entries
             */
            public function addContribution(
                string $pluginId,
                string $typeCode,
                string $ownership,
                array $entries,
            ): void {
                // stub
            }
        }
    }

    if (!\class_exists(PluginRealtimeTopicRegistryEvent::class, false)) {
        /**
         * Mirrors `App\Plugin\Event\PluginRealtimeTopicRegistryEvent::addTopic()`.
         */
        final class PluginRealtimeTopicRegistryEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function addTopic(
                string $pluginId,
                string $key,
                string $description,
                ?string $requiredPermission = null,
                ?string $payloadSchemaPath = null,
            ): void {
                // stub
            }
        }
    }

    if (!\class_exists(StyleRegistryEvent::class, false)) {
        /**
         * Mirrors `App\Plugin\Event\StyleRegistryEvent::addStyle()`.
         */
        final class StyleRegistryEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function addStyle(
                string $pluginId,
                string $name,
                string $description,
                string $category,
                bool $canHaveChildren,
            ): void {
                // stub
            }
        }
    }
}

namespace App\Plugin\Realtime {
    if (!\interface_exists(PluginRealtimePublisherInterface::class, false)) {
        interface PluginRealtimePublisherInterface
        {
            /**
             * @param array<string,mixed> $payload
             * @param array<string,mixed> $options
             */
            public function publish(string $pluginId, string $topic, array $payload, array $options = []): void;
        }
    }
}

namespace App\Service\CMS {
    if (!\class_exists(DataService::class, false)) {
        /**
         * Mirrors the host `App\Service\CMS\DataService::saveData()` surface
         * consumed by the SurveyJS data-table writer.
         */
        final class DataService
        {
            /**
             * @param array<string, mixed> $data
             * @param array<string, mixed>|null $updateBasedOn
             */
            public function saveData(
                string $tableName,
                array $data,
                string $transactionBy = 'by_user',
                ?array $updateBasedOn = null,
                bool $ownEntriesOnly = true,
            ): int|false {
                return false;
            }
        }
    }
}

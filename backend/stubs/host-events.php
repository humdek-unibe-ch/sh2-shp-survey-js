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

    if (!\class_exists(ApiRouteRegistryEvent::class, false)) {
        /**
         * Mirrors `App\Plugin\Event\ApiRouteRegistryEvent::addRoute()`.
         */
        final class ApiRouteRegistryEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function getCmsVersion(): string
            {
                return '';
            }

            /**
             * @param array<int,string> $methods
             * @param array<string,string> $requirements
             * @param array<int,string> $permissions
             */
            public function addRoute(
                string $pluginId,
                string $name,
                string $path,
                string $controller,
                array $methods,
                array $requirements = [],
                array $permissions = [],
                string $version = 'v1',
            ): void {
                // stub
            }

            /**
             * @return array<int, array{
             *   pluginId: string,
             *   name: string,
             *   path: string,
             *   controller: string,
             *   methods: array<int,string>,
             *   requirements: array<string,string>,
             *   permissions: array<int,string>,
             *   version: string,
             * }>
             */
            public function getRoutes(): array
            {
                return [];
            }
        }
    }
}

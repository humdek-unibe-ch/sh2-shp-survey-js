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

namespace App\Plugin\Event {
    if (!\class_exists(UserDataCleanupEvent::class, false)) {
        /** Mirrors the host event dispatched while a user's data is removed. */
        final class UserDataCleanupEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function getUserId(): int
            {
                return 0;
            }

            /**
             * @param \Closure(): void $callback
             */
            public function afterCommit(\Closure $callback): void
            {
            }
        }
    }
}

namespace App\Entity\Plugin {
    if (!\class_exists(Plugin::class, false)) {
        /** Mirrors the host plugin entity (only its type is used). */
        class Plugin
        {
        }
    }
}

namespace App\Entity {
    if (!\class_exists(DataTable::class, false)) {
        /** Mirrors the host data table entity surface the response store uses. */
        class DataTable
        {
            public function getId(): ?int
            {
                return null;
            }

            public function setName(string $name): static
            {
                return $this;
            }

            public function getDisplayName(): ?string
            {
                return null;
            }

            public function setDisplayName(?string $displayName): static
            {
                return $this;
            }

            public function getPlugin(): ?\App\Entity\Plugin\Plugin
            {
                return null;
            }

            public function setPlugin(?\App\Entity\Plugin\Plugin $plugin): static
            {
                return $this;
            }
        }
    }
}

namespace App\Service\Core {
    if (!\class_exists(LookupService::class, false)) {
        /** Mirrors the host lookup codes the plugin writes. */
        final class LookupService
        {
            public const DATA_REVISION_SOURCES_FORM = 'form';
            public const DATA_REVISION_SOURCES_SYSTEM = 'system';
            public const ACTION_TRIGGER_TYPES_STARTED = 'started';
            public const ACTION_TRIGGER_TYPES_FINISHED = 'finished';
            public const ACTION_TRIGGER_TYPES_UPDATED = 'updated';
            public const TRANSACTION_BY_BY_USER = 'by_user';
        }
    }
}

namespace App\Service\CMS\DataRevision {
    if (!\class_exists(RecordWriteContext::class, false)) {
        /** Mirrors the host write context (trusted writers pass no version). */
        final class RecordWriteContext
        {
            public function __construct(
                public string $source = 'form',
                public ?int $expectedVersion = null,
                public ?int $restoredFromVersion = null,
                public bool $interactive = false,
            ) {
            }
        }
    }
}

namespace App\Service\CMS\DataQuery {
    if (!\class_exists(DataFilter::class, false)) {
        final class DataFilter
        {
            public const OP_EQ = 'eq';
            public const OP_GTE = 'gte';
            public const OP_LTE = 'lte';
            public const OP_IN = 'in';

            public function __construct(
                public string $column,
                public string $operator,
                public mixed $value = null,
                public ?string $valueType = null,
            ) {
            }
        }
    }
    if (!\class_exists(DataFilterGroup::class, false)) {
        final class DataFilterGroup
        {
            public const MODE_AND = 'and';

            /**
             * @param list<DataFilter|DataFilterGroup> $children
             */
            public function __construct(
                public string $mode = self::MODE_AND,
                public array $children = [],
            ) {
            }
        }
    }
    if (!\class_exists(DataSort::class, false)) {
        final class DataSort
        {
            public const ASC = 'asc';
            public const DESC = 'desc';

            public function __construct(
                public string $column,
                public string $direction = self::ASC,
            ) {
            }
        }
    }
    if (!\class_exists(DataQuery::class, false)) {
        /** Mirrors the host data query (named arguments the store passes). */
        final class DataQuery
        {
            /**
             * @param list<DataSort> $sorts
             * @param list<string>|null $columns
             * @param array<string, string> $optionalColumns
             */
            public function __construct(
                public int $tableId,
                public string $ownerScope = 'any',
                public ?int $userId = null,
                public DataFilterGroup $filter = new DataFilterGroup(),
                public mixed $search = null,
                public array $sorts = [],
                public ?int $limit = 50,
                public int $offset = 0,
                public ?array $columns = null,
                public bool $excludeDeleted = true,
                public int $languageId = 1,
                public bool $allLanguages = false,
                public string $timezone = 'UTC',
                public bool $withTotal = false,
                public array $optionalColumns = [],
            ) {
            }
        }
    }
    if (!\class_exists(DataQueryResult::class, false)) {
        final class DataQueryResult
        {
            /**
             * @param list<array<string, mixed>> $rows
             */
            public function __construct(
                public array $rows,
                public ?int $total,
            ) {
            }
        }
    }
    if (!\class_exists(DataQueryEngine::class, false)) {
        /** Mirrors the host read path for data tables (rule 2.7). */
        class DataQueryEngine
        {
            public function run(DataQuery $query): DataQueryResult
            {
                return new DataQueryResult([], null);
            }
        }
    }
}

namespace App\Service\CMS {
    if (!\class_exists(DataService::class, false)) {
        /**
         * Mirrors the host `App\Service\CMS\DataService` surface the SurveyJS
         * response store uses (write and delete path, rule 2.4).
         */
        class DataService
        {
            /**
             * @param array<string, mixed> $data
             * @param array<string, mixed>|null $updateBasedOn
             * @param array<string, string|null>|null $fieldLabels
             */
            public function saveData(
                string $tableName,
                array $data,
                string $transactionBy = 'by_user',
                ?array $updateBasedOn = null,
                bool $ownEntriesOnly = true,
                ?array $fieldLabels = null,
                ?\App\Service\CMS\DataRevision\RecordWriteContext $context = null,
            ): int|false {
                return false;
            }

            public function deleteData(int $dataTableId, int $recordId, bool $ownEntriesOnly = true, ?\App\Service\CMS\DataRevision\RecordWriteContext $context = null): bool
            {
                return false;
            }

            public function getDataTableByName(string $tableName): ?\App\Entity\DataTable
            {
                return null;
            }
        }
    }
}

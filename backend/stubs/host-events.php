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
        class LookupService
        {
            public const DATA_REVISION_SOURCES_FORM = 'form';
            public const DATA_REVISION_SOURCES_SYSTEM = 'system';
            public const ACTION_TRIGGER_TYPES_STARTED = 'started';
            public const ACTION_TRIGGER_TYPES_FINISHED = 'finished';
            public const ACTION_TRIGGER_TYPES_UPDATED = 'updated';
            public const TRANSACTION_BY_BY_USER = 'by_user';
            public const RESOURCE_TYPES = 'resourceTypes';
            public const RESOURCE_TYPES_DATA_TABLE = 'data_table';

            public function getLookupIdByCode(string $typeCode, string $lookupCode): ?int
            {
                return null;
            }
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
    if (!\class_exists(DataColumnService::class, false)) {
        /** Mirrors the host's reserved data column keys and the call that marks upload columns. */
        class DataColumnService
        {
            public const RESERVED_KEYS = ['id', 'id_users', 'record_id', 'entry_date', 'user_name', 'user_code', 'triggerType', 'trigger_type', 'language_id', 'deleted', 'record', 'scope', 'user', 'metadata'];

            /** @param list<string> $fieldKeys */
            public function markFileColumns(\App\Entity\DataTable $dataTable, array $fieldKeys): void
            {
            }
        }
    }

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

    if (!\class_exists(FormFileUploadService::class, false)) {
        /** Mirrors the host `App\Service\CMS\FormFileUploadService` surface survey uploads use. */
        class FormFileUploadService
        {
            public const UPLOAD_DIR = 'uploads/form-files/';

            public function storeRecordFile(\Symfony\Component\HttpFoundation\File\UploadedFile $file, int $dataTableId, int $recordId, string $fieldKey, ?int $userId): string
            {
                return '';
            }

            public function isRecordFileKey(string $key, int $dataTableId, int $recordId): bool
            {
                return false;
            }

            public function resolveKey(string $key): ?string
            {
                return null;
            }

            public static function nameOfKey(string $key): string
            {
                return preg_replace('/^\d+_[0-9a-f]{8}_/', '', basename($key)) ?? basename($key);
            }

            /** @return list<string> */
            public static function keysIn(?string $value): array
            {
                $decoded = $value !== null && $value !== '' ? json_decode($value, true) : null;
                $leaves = [];
                if (is_array($decoded)) {
                    array_walk_recursive($decoded, static function (mixed $leaf) use (&$leaves): void {
                        $leaves[] = $leaf;
                    });
                } elseif ($value !== null) {
                    $leaves[] = $value;
                }

                return array_values(array_unique(array_filter(
                    $leaves,
                    static fn (mixed $leaf): bool => is_string($leaf) && str_starts_with($leaf, self::UPLOAD_DIR) && !str_contains($leaf, '..'),
                )));
            }
        }
    }

    if (!\class_exists(DataTableService::class, false)) {
        /** Mirrors the host `App\Service\CMS\DataTableService` call the survey delete uses. */
        class DataTableService
        {
            public function deleteDataTable(string $tableName): bool
            {
                return false;
            }
        }
    }
}

namespace App\Exception {
    if (!\class_exists(ServiceException::class, false)) {
        /** Mirrors the host service exception (the code is the HTTP status). */
        class ServiceException extends \Exception
        {
            /**
             * @param array<string, mixed>|null $data
             */
            public function __construct(string $message, int $code = 400, ?array $data = null)
            {
                parent::__construct($message, $code);
            }
        }
    }
}

namespace App\Entity {
    if (!\class_exists(Lookup::class, false)) {
        class Lookup
        {
            public function getLookupCode(): ?string
            {
                return null;
            }
        }
    }
    if (!\class_exists(User::class, false)) {
        class User
        {
            public function getId(): ?int
            {
                return null;
            }

            public function getTimezone(): ?Lookup
            {
                return null;
            }
        }
    }
    if (!\class_exists(Page::class, false)) {
        class Page
        {
        }
    }
}

namespace App\Service\Core {
    if (!\class_exists(UserContextAwareService::class, false)) {
        class UserContextAwareService
        {
            public function getCurrentUser(): ?\App\Entity\User
            {
                return null;
            }
        }
    }
    if (!\class_exists(InterpolationService::class, false)) {
        class InterpolationService
        {
            /**
             * @param array<array-key, mixed> $contentArray
             * @param array<array-key, mixed> ...$dataArrays
             * @return array<array-key, mixed>
             */
            public function interpolateArray(array $contentArray, array ...$dataArrays): array
            {
                return $contentArray;
            }
        }
    }
}

namespace App\Service\CMS {
    if (!\class_exists(CmsPreferenceService::class, false)) {
        class CmsPreferenceService
        {
            public function getDefaultTimezone(): ?\App\Entity\Lookup
            {
                return null;
            }
        }
    }
}

namespace App\Service\CMS\Effective {
    if (!\class_exists(PublicSectionScope::class, false)) {
        /** Mirrors the host scope of a public section (H4). */
        final class PublicSectionScope
        {
            /**
             * @param array<string, array<int, string>> $fields
             */
            public function __construct(
                public readonly \App\Entity\Page $page,
                public readonly object $effective,
                public readonly int $sectionId,
                public readonly array $fields,
            ) {
            }

            public function field(string $name, int $languageId = 1): string
            {
                return '';
            }
        }
    }
    if (!\class_exists(PublicSectionAccessService::class, false)) {
        /** Mirrors the host check "may this caller use section S of page P" (H4, H1). */
        class PublicSectionAccessService
        {
            public function forSection(int $pageId, int $sectionId, string $styleName, bool $preview = false): PublicSectionScope
            {
                throw new \LogicException('stub');
            }

            /**
             * @param array<string, string> $routeParams
             * @return array<array-key, mixed>
             */
            public function variables(PublicSectionScope $scope, int $languageId, array $routeParams = []): array
            {
                return [];
            }
        }
    }
}

namespace App\Entity {
    if (!\class_exists(Role::class, false)) {
        class Role
        {
            public function getId(): ?int
            {
                return null;
            }

            public function getName(): string
            {
                return '';
            }
        }
    }
    if (!\class_exists(RoleDataAccess::class, false)) {
        class RoleDataAccess
        {
            public function getId(): ?int
            {
                return null;
            }

            public function getRole(): Role
            {
                return new Role();
            }

            public function getCrudPermissions(): int
            {
                return 0;
            }
        }
    }
}

namespace App\Service\Security {
    if (!\class_exists(DataAccessSecurityService::class, false)) {
        /** Mirrors the host data-access checks (role_data_access grants). */
        class DataAccessSecurityService
        {
            public const PERMISSION_CREATE = 1;
            public const PERMISSION_READ = 2;
            public const PERMISSION_UPDATE = 4;
            public const PERMISSION_DELETE = 8;
            public const ADMIN_ROLE_NAME = 'admin';

            public function hasPermission(int $userId, string $resourceType, int $resourceId, int $requiredPermission): bool
            {
                return false;
            }

            public function userHasAdminRole(int $userId): bool
            {
                return false;
            }
        }
    }
}

namespace App\Service\CMS\Admin {
    if (!\class_exists(AdminDataAccessService::class, false)) {
        /** Mirrors the one host writer of role_data_access grants. */
        class AdminDataAccessService
        {
            public function addRolePermission(int $roleId, \stdClass $permissionData): \App\Entity\RoleDataAccess
            {
                return new \App\Entity\RoleDataAccess();
            }

            public function deleteRolePermission(int $roleId, int $permissionId): void
            {
            }
        }
    }
}

namespace App\Plugin\Event {
    if (!\class_exists(DataAccessResourcesEvent::class, false)) {
        final class DataAccessResourcesEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            /** @var array<int, array{id: int, name: string, description: string|null}> */
            private array $resources = [];

            public function __construct(public readonly string $resourceTypeCode)
            {
            }

            public function addResource(int $id, string $name, ?string $description = null): void
            {
                $this->resources[$id] = ['id' => $id, 'name' => $name, 'description' => $description];
            }

            /** @return list<array{id: int, name: string, description: string|null}> */
            public function getResources(): array
            {
                $resources = array_values($this->resources);
                usort($resources, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

                return $resources;
            }
        }
    }
    if (!\class_exists(SectionFieldBindingEvent::class, false)) {
        /** Mirrors the host event of H7 (a section field value being authored). */
        final class SectionFieldBindingEvent extends \Symfony\Contracts\EventDispatcher\Event
        {
            public function __construct(
                public readonly string $fieldName,
                public readonly ?string $fieldTypeName,
                public readonly string $value,
                public readonly int $userId,
            ) {
            }

            private ?string $denial = null;

            public function deny(string $reason): void
            {
                $this->denial ??= $reason;
            }

            public function getDenial(): ?string
            {
                return $this->denial;
            }
        }
    }
}

namespace App\Service\Core {
    if (!\class_exists(ApiResponseFormatter::class, false)) {
        /** Mirrors the host envelope builder (`status`, `message`, `error`, `logged_in`, `meta`, `data`). */
        class ApiResponseFormatter
        {
            public function formatSuccess(mixed $data = null, ?string $responseSchemaName = null, int $status = 200, bool $isLoggedIn = false, bool $skipNormalization = false): \Symfony\Component\HttpFoundation\JsonResponse
            {
                return new \Symfony\Component\HttpFoundation\JsonResponse(['status' => $status, 'message' => 'OK', 'error' => null, 'logged_in' => $isLoggedIn, 'meta' => [], 'data' => $data], $status);
            }

            /**
             * @param list<string>|null $validationErrors
             */
            public function formatError(string $error, int $status = 400, mixed $data = null, ?array $validationErrors = null): \Symfony\Component\HttpFoundation\JsonResponse
            {
                return new \Symfony\Component\HttpFoundation\JsonResponse(['status' => $status, 'message' => 'Error', 'error' => $error, 'logged_in' => false, 'meta' => [], 'data' => $data, 'validation' => $validationErrors], $status);
            }
        }
    }
}

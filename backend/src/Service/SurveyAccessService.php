<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Entity\DataTable;
use App\Entity\Role;
use App\Entity\RoleDataAccess;
use App\Service\CMS\Admin\AdminDataAccessService;
use App\Service\CMS\UserPermissionService;
use App\Service\Core\LookupService;
use App\Service\Core\UserContextAwareService;
use App\Service\Security\DataAccessSecurityService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;

/**
 * Who may do what with a survey (concept section 6). A survey is a resource
 * of core data access, type `surveyjs_survey` (H6), like a page or an asset:
 * the route permission (`surveyjs.survey.*`) says what a role may do at all,
 * the grant in `role_data_access` says on which surveys. The admin role may
 * do everything and never gets a grant.
 *
 * Who may see, export or delete a survey's answers is the grant on its data
 * table, the same as for any form's data.
 */
class SurveyAccessService
{
    public const RESOURCE_TYPE = 'surveyjs_survey';
    public const PERMISSION_CREATE = 'surveyjs.survey.create';
    public const PERMISSION_UPDATE = 'surveyjs.survey.update';
    public const PERMISSION_PUBLISH = 'surveyjs.survey.publish';
    public const PERMISSION_DELETE = 'surveyjs.survey.delete';
    public const READ = DataAccessSecurityService::PERMISSION_READ;
    public const UPDATE = DataAccessSecurityService::PERMISSION_UPDATE;
    public const DELETE = DataAccessSecurityService::PERMISSION_DELETE;
    private const FULL_ACCESS = DataAccessSecurityService::PERMISSION_CREATE
        | DataAccessSecurityService::PERMISSION_READ
        | DataAccessSecurityService::PERMISSION_UPDATE
        | DataAccessSecurityService::PERMISSION_DELETE;

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly DataAccessSecurityService $security,
        private readonly AdminDataAccessService $dataAccess,
        private readonly LookupService $lookups,
        private readonly UserContextAwareService $userContext,
        private readonly UserPermissionService $userPermissions,
    ) {
    }

    /** Whether the caller holds the grant `$permission` (READ, UPDATE, DELETE) on the survey. */
    public function can(Survey $survey, int $permission): bool
    {
        $userId = $this->userId();

        return $userId !== null && $this->userCan($userId, $survey, $permission);
    }

    /** Whether user `$userId` holds the grant `$permission` on the survey. */
    public function userCan(int $userId, Survey $survey, int $permission): bool
    {
        return $survey->getId() !== null
            && $this->security->hasPermission($userId, self::RESOURCE_TYPE, (int) $survey->getId(), $permission);
    }

    /**
     * Ids of the surveys the caller may see in the admin, or null for the
     * admin role (no restriction).
     *
     * @return list<int>|null
     */
    public function readableSurveyIdsOrNull(): ?array
    {
        $masks = $this->grantMasksOrNull();
        if ($masks === null) {
            return null;
        }

        return array_keys(array_filter($masks, static fn (int $mask): bool => ($mask & self::READ) !== 0));
    }

    /** Whether the caller may create surveys (the route permission; a new survey has no grant yet). */
    public function canCreate(): bool
    {
        return in_array(self::PERMISSION_CREATE, $this->callerPermissions(), true);
    }

    /**
     * What the caller may do with each survey, so the admin screens show only
     * the actions that will succeed: the route permission and the grant
     * together, as the actions check them. One query for all surveys and no
     * audit row per check; the actions themselves still check and audit.
     *
     * @param list<Survey> $surveys
     * @return array<int, array{update: bool, publish: bool, delete: bool}> keyed by survey id
     */
    public function rightsFor(array $surveys): array
    {
        $permissions = $this->callerPermissions();

        return self::rightsFromGrants($surveys, $permissions, $permissions === [] ? [] : $this->grantMasksOrNull());
    }

    /**
     * The decision behind {@see rightsFor()}: an action needs its route
     * permission and the matching grant bit (publishing: the update grant).
     *
     * @param list<Survey> $surveys
     * @param list<string> $permissions the caller's permission names
     * @param array<int, int>|null $masks grant bits per survey id; null: admin, every grant
     * @return array<int, array{update: bool, publish: bool, delete: bool}>
     */
    public static function rightsFromGrants(array $surveys, array $permissions, ?array $masks): array
    {
        $rights = [];
        foreach ($surveys as $survey) {
            $id = (int) $survey->getId();
            $mask = $masks === null ? self::FULL_ACCESS : ($masks[$id] ?? 0);
            $rights[$id] = [
                'update' => ($mask & self::UPDATE) !== 0 && in_array(self::PERMISSION_UPDATE, $permissions, true),
                'publish' => ($mask & self::UPDATE) !== 0 && in_array(self::PERMISSION_PUBLISH, $permissions, true),
                'delete' => ($mask & self::DELETE) !== 0 && in_array(self::PERMISSION_DELETE, $permissions, true),
            ];
        }

        return $rights;
    }

    /**
     * The caller's grant on every survey (bits OR-ed over their roles), or
     * null for the admin role (every right on every survey).
     *
     * @return array<int, int>|null
     */
    private function grantMasksOrNull(): ?array
    {
        $userId = $this->userId();
        if ($userId === null) {
            return [];
        }
        if ($this->security->userHasAdminRole($userId)) {
            return null;
        }

        /** @var list<array{resourceId: int|string, crud: int|string}> $rows */
        $rows = $this->em->createQueryBuilder()
            ->select('rda.resourceId AS resourceId', 'rda.crudPermissions AS crud')
            ->from(RoleDataAccess::class, 'rda')
            ->innerJoin('rda.role', 'r')
            ->innerJoin('r.users', 'u')
            ->where('u.id = :userId')
            ->andWhere('rda.idResourceTypes = :type')
            ->setParameter('userId', $userId)
            ->setParameter('type', $this->resourceTypeId())
            ->getQuery()
            ->getArrayResult();

        $masks = [];
        foreach ($rows as $row) {
            $id = (int) $row['resourceId'];
            $masks[$id] = ($masks[$id] ?? 0) | (int) $row['crud'];
        }

        return $masks;
    }

    /**
     * The caller's permission names, from the same cached source as the
     * host's own checks (the request's user entity carries no loaded roles).
     *
     * @return list<string>
     */
    private function callerPermissions(): array
    {
        $user = $this->userContext->getCurrentUser();

        return $user === null || $user->getId() === null ? [] : $this->userPermissions->getUserPermissions($user);
    }

    /**
     * A new survey: the creator's roles that hold `surveyjs.survey.create` get
     * all four rights on it (the rule of pages, F14, and assets). An admin
     * creator needs no grant.
     */
    public function grantCreatorRoles(Survey $survey): void
    {
        $userId = $this->userId();
        if ($userId === null || $survey->getId() === null) {
            return;
        }

        /** @var list<array{id: int|string}> $rows */
        $rows = $this->em->createQueryBuilder()
            ->select('DISTINCT r.id')
            ->from(Role::class, 'r')
            ->innerJoin('r.users', 'u')
            ->innerJoin('r.permissions', 'p')
            ->where('u.id = :userId')
            ->andWhere('p.name = :permission')
            ->andWhere('r.name != :adminRole')
            ->setParameter('userId', $userId)
            ->setParameter('permission', self::PERMISSION_CREATE)
            ->setParameter('adminRole', DataAccessSecurityService::ADMIN_ROLE_NAME)
            ->getQuery()
            ->getArrayResult();

        foreach ($rows as $row) {
            $this->grant((int) $row['id'], $this->resourceTypeId(), (int) $survey->getId());
        }
    }

    /**
     * The survey's data table was just created: the roles that may edit the
     * survey get full rights on it (F15). From then on the two grants are
     * independent.
     */
    public function grantDataTableToSurveyEditors(Survey $survey, DataTable $table): void
    {
        $tableTypeId = (int) $this->lookups->getLookupIdByCode(LookupService::RESOURCE_TYPES, LookupService::RESOURCE_TYPES_DATA_TABLE);
        if ($survey->getId() === null || $table->getId() === null || $tableTypeId === 0) {
            return;
        }
        foreach ($this->grantsOn($survey) as $grant) {
            if (($grant->getCrudPermissions() & self::UPDATE) !== 0
                && $grant->getRole()->getName() !== DataAccessSecurityService::ADMIN_ROLE_NAME) {
                $this->grant((int) $grant->getRole()->getId(), $tableTypeId, (int) $table->getId());
            }
        }
    }

    /** Removes every grant on a survey that is being deleted. */
    public function revokeAll(Survey $survey): void
    {
        foreach ($this->grantsOn($survey) as $grant) {
            $this->dataAccess->deleteRolePermission((int) $grant->getRole()->getId(), (int) $grant->getId());
        }
    }

    /**
     * Whether the caller holds `$permission` on the survey's answers: the
     * grant on its data table (none before the first response).
     */
    public function canOnResponses(Survey $survey, int $permission): bool
    {
        $userId = $this->userId();
        if ($userId === null) {
            return false;
        }
        if ($this->security->userHasAdminRole($userId)) {
            return true;
        }
        $table = $this->em->getRepository(DataTable::class)->findOneBy(['name' => SurveyResponseStore::tableNameFor($survey)]);
        if (!$table instanceof DataTable || $table->getId() === null) {
            return false;
        }

        return $this->canOnDataTable((int) $table->getId(), $permission);
    }

    /** Whether the caller holds `$permission` on data table `$tableId` (the admin role always does). */
    public function canOnDataTable(int $tableId, int $permission): bool
    {
        $userId = $this->userId();
        if ($userId === null) {
            return false;
        }

        return $this->security->hasPermission($userId, LookupService::RESOURCE_TYPES_DATA_TABLE, $tableId, $permission);
    }

    /**
     * @return list<RoleDataAccess>
     */
    private function grantsOn(Survey $survey): array
    {
        return array_values($this->em->getRepository(RoleDataAccess::class)->findBy([
            'idResourceTypes' => $this->resourceTypeId(),
            'resourceId' => (int) $survey->getId(),
        ]));
    }

    private function grant(int $roleId, int $resourceTypeId, int $resourceId): void
    {
        $this->dataAccess->addRolePermission($roleId, (object) [
            'resource_type_id' => $resourceTypeId,
            'resource_id' => $resourceId,
            'crud_permissions' => self::FULL_ACCESS,
        ]);
    }

    private function resourceTypeId(): int
    {
        return (int) $this->lookups->getLookupIdByCode(LookupService::RESOURCE_TYPES, self::RESOURCE_TYPE);
    }

    private function userId(): ?int
    {
        $userId = $this->userContext->getCurrentUser()?->getId();

        return $userId !== null && $userId > 0 ? $userId : null;
    }
}

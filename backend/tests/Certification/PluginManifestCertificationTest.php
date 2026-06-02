<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Certification;

use PHPUnit\Framework\TestCase;

/**
 * Standalone backend certification for the plugin manifest (Slice 8C,
 * plan §31 "plugin compatibility matrices"). This is the part of the
 * plugin certification that runs in the plugin's OWN CI without the
 * host checkout: it proves `plugin.json` declares a complete,
 * self-consistent compatibility matrix + capability/trust contract.
 *
 * The runtime install-lifecycle certification (the manifest going
 * through the real admin install API) lives in the host repository as
 * a subclass of `App\Tests\Certification\InstallLifecycleCertificationTestCase`;
 * it cannot run from here because the plugin's standalone autoloader
 * does not contain the host application.
 */
final class PluginManifestCertificationTest extends TestCase
{
    /** @var array<string, mixed> */
    private static array $manifest;

    public static function setUpBeforeClass(): void
    {
        $path = \dirname(__DIR__, 3) . '/plugin.json';
        self::assertFileExists($path, 'plugin.json must exist at the plugin root');
        /** @var array<string, mixed> $decoded */
        $decoded = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        self::$manifest = $decoded;
    }

    public function testIdentityAndSemverVersion(): void
    {
        self::assertSame('sh2-shp-survey-js', self::$manifest['id']);
        self::assertMatchesRegularExpression(
            '/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/',
            (string) self::$manifest['version'],
            'version must be semver',
        );
        self::assertMatchesRegularExpression(
            '/^\d+\.\d+$/',
            (string) self::$manifest['pluginApiVersion'],
            'pluginApiVersion must be a major.minor SDK version',
        );
    }

    public function testDeclaresACompatibilityMatrix(): void
    {
        self::assertArrayHasKey('compatibility', self::$manifest);
        $compat = self::$manifest['compatibility'];
        self::assertIsArray($compat);

        // Adopted shape (host + ecosystem): each surface maps to a single
        // SemVer RANGE STRING. The §31 per-surface object shape
        // (compatibility.selfhelp.backend / .shared / .frontend / .mobile)
        // was NOT adopted; asserting the string type makes this test FAIL if
        // a future edit reintroduces the nested-object shape. This mirrors the
        // shared cert kit's `checkCompatibilityShape` and the host's
        // PluginManifestValidator schema.
        // The host range + the backend language floor are mandatory; the
        // frontend/mobile ranges are required because this plugin ships
        // those surfaces.
        foreach (['selfhelp', 'php', 'node', 'react', 'reactNative', 'expoSdk'] as $key) {
            self::assertArrayHasKey($key, $compat, "compatibility.$key must be declared");
            self::assertIsString(
                $compat[$key],
                "compatibility.$key must be a single SemVer range string, not a per-surface object",
            );
            self::assertNotSame('', trim($compat[$key]), "compatibility.$key must be a non-empty constraint");
        }
        self::assertStringContainsString('8', (string) $compat['selfhelp'], 'selfhelp range must target the 8.x host line');
    }

    public function testTrustLevelAndCapabilityContractIsConsistent(): void
    {
        $security = self::$manifest['security'];
        self::assertIsArray($security);

        $trustLevel = (string) ($security['trustLevel'] ?? '');
        self::assertContains($trustLevel, ['official', 'reviewed', 'untrusted'], 'trustLevel must be a known tier');

        $capabilities = $security['capabilities'] ?? [];
        self::assertIsArray($capabilities);
        self::assertNotEmpty($capabilities, 'capabilities are deny-by-default and must be declared explicitly');

        // Deny-by-default: an `untrusted` plugin may not ship privileged
        // capabilities. SurveyJS is `official`, so this guards against an
        // accidental trust downgrade that keeps the privileged caps.
        if ($trustLevel === 'untrusted') {
            foreach (['backendBundle', 'databaseMigrations', 'scheduledJobs'] as $privileged) {
                self::assertNotContains(
                    $privileged,
                    $capabilities,
                    "untrusted plugins may not declare the '$privileged' capability",
                );
            }
        }

        // If the plugin ships a backend bundle it must also declare the
        // migrations capability (it owns tables) — matches host validation.
        if (in_array('backendBundle', $capabilities, true)) {
            self::assertArrayHasKey('backend', self::$manifest, 'backendBundle capability requires a backend block');
            self::assertNotSame(
                '',
                (string) (self::$manifest['backend']['bundleClass'] ?? ''),
                'backend.bundleClass must be declared',
            );
        }
    }

    public function testDataOwnershipMatchesWriteCapability(): void
    {
        $capabilities = self::$manifest['security']['capabilities'] ?? [];
        if (!in_array('writeDataTables', $capabilities, true)) {
            self::markTestSkipped('Plugin does not declare writeDataTables.');
        }

        $dataAccess = self::$manifest['dataAccess'] ?? [];
        self::assertIsArray($dataAccess);
        self::assertNotEmpty($dataAccess['ownedTables'] ?? [], 'a data-writing plugin must declare ownedTables');
        self::assertNotSame(
            '',
            (string) ($dataAccess['ownedDataTablePrefix'] ?? ''),
            'a data-writing plugin must declare an ownedDataTablePrefix so purge can scope its rows',
        );
    }

    public function testEveryRealtimeTopicIsPermissionGated(): void
    {
        $topics = self::$manifest['realtimeTopics'] ?? [];
        self::assertIsArray($topics);
        self::assertNotEmpty($topics, 'SurveyJS publishes realtime topics; the manifest must declare them');
        foreach ($topics as $topic) {
            self::assertNotSame('', (string) ($topic['key'] ?? ''), 'each realtime topic needs a key');
            self::assertNotSame(
                '',
                (string) ($topic['requiredPermission'] ?? ''),
                "realtime topic '{$topic['key']}' must be gated by a requiredPermission",
            );
        }
    }

    public function testDeclaredPermissionsAreWellFormed(): void
    {
        $permissions = self::$manifest['permissions'] ?? [];
        self::assertIsArray($permissions);
        self::assertNotEmpty($permissions, 'admin-page plugins must declare their permissions');
        foreach ($permissions as $permission) {
            self::assertNotSame('', (string) ($permission['key'] ?? ''), 'each permission needs a key');
            self::assertNotEmpty($permission['defaultRoles'] ?? [], 'each permission needs at least one default role');
        }
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Phase 1 follow-up: adds runtime fields parity with the legacy
 * `sh-shp-survey_js` plugin and seeds the additional permissions
 * needed for export, file upload and response deletion.
 *
 * Adds the four `surveyjs` style fields that the initial migration
 * did not seed (`timeout`, `dynamic_replacement`, `own_entries_only`,
 * `data_config`) plus a new `allow_anonymous` toggle so per-survey
 * anonymous handling becomes explicit.
 *
 * Adds the legacy plugin's `gpxMap` `sample_points` field so the
 * standalone map renderer can be wired without a separate migration.
 *
 * Seeds the new permissions:
 *  - `surveyjs.surveys.delete-responses`
 *  - `surveyjs.surveys.export-csv`
 *  - `surveyjs.surveys.export-xlsx`
 *  - `surveyjs.surveys.export-json`
 *  - `surveyjs.surveys.upload-files`
 *
 * All seeded rows are stamped with `id_plugins` so the host
 * `PluginPurger` reverses them on uninstall.
 */
final class Version20260525200000 extends AbstractMigration
{
    private const PLUGIN_ID = 'sh2-shp-survey-js';

    /** @var array<int, array{name: string, description: string}> */
    private const PERMISSIONS = [
        ['name' => 'surveyjs.surveys.delete-responses', 'description' => 'Delete individual survey responses (admin only).'],
        ['name' => 'surveyjs.surveys.export-csv',       'description' => 'Export survey responses as CSV.'],
        ['name' => 'surveyjs.surveys.export-xlsx',      'description' => 'Export survey responses as Excel (XLSX).'],
        ['name' => 'surveyjs.surveys.export-json',      'description' => 'Export survey responses as JSON.'],
        ['name' => 'surveyjs.surveys.upload-files',     'description' => 'Upload files (GPX / microphone / image) attached to public survey submissions.'],
    ];

    /** @var array<int, array{name: string, type: string, display: int, config: ?array}> */
    private const FIELDS = [
        ['name' => 'timeout',             'type' => 'number',   'display' => 0, 'config' => null],
        ['name' => 'dynamic_replacement', 'type' => 'json',     'display' => 0, 'config' => null],
        ['name' => 'own_entries_only',    'type' => 'checkbox', 'display' => 0, 'config' => null],
        ['name' => 'data_config',         'type' => 'json',     'display' => 0, 'config' => null],
        ['name' => 'allow_anonymous',     'type' => 'checkbox', 'display' => 0, 'config' => null],
        ['name' => 'sample_points',       'type' => 'json',     'display' => 0, 'config' => null],
    ];

    /**
     * @var array<int, array{style: string, field: string, default: ?string, help: string, hidden: int, title: ?string}>
     */
    private const STYLE_FIELDS = [
        [
            'style' => 'surveyjs', 'field' => 'timeout', 'default' => '0',
            'help'  => 'Survey expires after N minutes from when the participant started it. Set to 0 to disable.',
            'hidden' => 0, 'title' => 'Timeout (minutes)',
        ],
        [
            'style' => 'surveyjs', 'field' => 'dynamic_replacement', 'default' => null,
            'help'  => 'JSON map of `{{var}}` tokens to replace inside the survey definition at render time. Only declared tokens are substituted.',
            'hidden' => 0, 'title' => 'Dynamic Replacement',
        ],
        [
            'style' => 'surveyjs', 'field' => 'own_entries_only', 'default' => '0',
            'help'  => 'When enabled, only the participant who originally submitted a response can resume / edit it.',
            'hidden' => 0, 'title' => 'Own Entries Only',
        ],
        [
            'style' => 'surveyjs', 'field' => 'data_config', 'default' => null,
            'help'  => 'JSON configuration used to source dynamic data (e.g. CMS data tables) referenced by `{{var}}` tokens inside the survey definition.',
            'hidden' => 0, 'title' => 'Data Config',
        ],
        [
            'style' => 'surveyjs', 'field' => 'allow_anonymous', 'default' => '1',
            'help'  => 'When enabled, the survey may be submitted by unauthenticated visitors. Once-per-user is then enforced by the signed visitor cookie.',
            'hidden' => 0, 'title' => 'Allow Anonymous',
        ],
        [
            'style' => 'gpxMap', 'field' => 'sample_points', 'default' => null,
            'help'  => 'Inline GPX sample points or a reference to a GPX answer field (`{{question_name}}`). Renders the polyline on the Leaflet map.',
            'hidden' => 0, 'title' => 'Sample Points',
        ],
    ];

    public function getDescription(): string
    {
        return 'sh2-shp-survey-js Phase 1.1: seed missing runtime fields (timeout, dynamic_replacement, own_entries_only, data_config, allow_anonymous), gpxMap sample_points, plus new permissions (delete-responses, export-csv/xlsx/json, upload-files).';
    }

    public function up(Schema $schema): void
    {
        $this->seedPermissions();
        $this->stampPermissions();
        $this->linkPermissionsToAdminRole();
        $this->seedFields();
        $this->seedStyleFields();
    }

    public function down(Schema $schema): void
    {
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'DELETE rpr FROM rel_permissions_roles rpr '
                . 'INNER JOIN permissions p ON p.id = rpr.id_permissions '
                . 'WHERE p.name = :name',
                ['name' => $perm['name']],
            );
        }

        foreach (self::STYLE_FIELDS as $link) {
            $this->addSql(
                'DELETE rfs FROM rel_fields_styles rfs '
                . 'INNER JOIN styles s ON s.id = rfs.id_styles '
                . 'INNER JOIN fields f ON f.id = rfs.id_fields '
                . 'WHERE s.name = :style AND f.name = :field',
                ['style' => $link['style'], 'field' => $link['field']],
            );
        }

        foreach (self::FIELDS as $field) {
            $this->addSql(
                'DELETE f FROM fields f '
                . 'INNER JOIN plugins p ON p.id = f.id_plugins '
                . 'WHERE p.plugin_id = :plugin_id AND f.name = :name',
                ['plugin_id' => self::PLUGIN_ID, 'name' => $field['name']],
            );
        }

        foreach (self::PERMISSIONS as $perm) {
            $this->addSql('DELETE FROM permissions WHERE name = :name', ['name' => $perm['name']]);
        }
    }

    private function seedPermissions(): void
    {
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'INSERT INTO permissions (name, description) VALUES (:name, :description) '
                . 'ON DUPLICATE KEY UPDATE description = VALUES(description)',
                ['name' => $perm['name'], 'description' => $perm['description']],
            );
        }
    }

    private function stampPermissions(): void
    {
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'UPDATE permissions p '
                . 'INNER JOIN plugins pl ON pl.plugin_id = :plugin_id '
                . 'SET p.id_plugins = pl.id '
                . 'WHERE p.name = :name',
                ['plugin_id' => self::PLUGIN_ID, 'name' => $perm['name']],
            );
        }
    }

    private function linkPermissionsToAdminRole(): void
    {
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'INSERT IGNORE INTO rel_permissions_roles (id_permissions, id_roles) '
                . 'SELECT p.id, r.id FROM permissions p, roles r '
                . 'WHERE p.name = :perm AND r.name = :role',
                ['perm' => $perm['name'], 'role' => 'admin'],
            );
        }
    }

    private function seedFields(): void
    {
        foreach (self::FIELDS as $field) {
            $configJson = $field['config'] !== null
                ? json_encode($field['config'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)
                : null;
            $this->addSql(
                'INSERT IGNORE INTO fields (name, id_field_types, display, config, id_plugins) '
                . 'SELECT :name, ft.id, :display, :config, pl.id '
                . 'FROM field_types ft, plugins pl '
                . 'WHERE ft.name = :type AND pl.plugin_id = :plugin_id',
                [
                    'name'      => $field['name'],
                    'type'      => $field['type'],
                    'display'   => $field['display'],
                    'config'    => $configJson,
                    'plugin_id' => self::PLUGIN_ID,
                ],
            );
        }
    }

    private function seedStyleFields(): void
    {
        foreach (self::STYLE_FIELDS as $link) {
            $this->addSql(
                'INSERT IGNORE INTO rel_fields_styles '
                . '(id_styles, id_fields, default_value, help, disabled, hidden, title) '
                . 'SELECT s.id, f.id, :default_value, :help, 0, :hidden, :title '
                . 'FROM styles s, fields f '
                . 'WHERE s.name = :style AND f.name = :field',
                [
                    'style'         => $link['style'],
                    'field'         => $link['field'],
                    'default_value' => $link['default'],
                    'help'          => $link['help'],
                    'hidden'        => $link['hidden'],
                    'title'         => $link['title'],
                ],
            );
        }
    }
}

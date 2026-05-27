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
 * SurveyJS plugin — single consolidated install migration.
 *
 * The plugin is still pre-release, so fresh installs use this one
 * migration to register the complete schema + CMS surface in one
 * shot. Previously this work was split across three Doctrine
 * migrations (`Version20260522063620`, `Version20260525200000`,
 * `Version20260525200500`); the latter two have been folded into
 * this file so install / uninstall always sees a single matching
 * pair of up / down statements.
 *
 * Plugin-owned tables:
 *   - `surveys`                   survey aggregate root + draft columns.
 *   - `survey_versions`           immutable definition snapshots.
 *   - `survey_runs`               submission metadata, FK into core `data_rows`,
 *                                 carries `visitor_id` for anonymous once-per-user.
 *   - `survey_answer_links`       per-question link into core `data_cells`.
 *   - `survey_response_drafts`    cross-device per-page autosave drafts.
 *   - `survey_files`              private file uploads (GPX / mic / image).
 *
 * CMS registration:
 *   - `style_groups` row "Plugin: SurveyJS" so the plugin's styles
 *     show up in their own bucket of the Add-Section modal,
 *   - `field_types` rows (`select-survey-js`, `select-survey-js-theme`)
 *     consumed by the section-field editor,
 *   - the full legacy plugin field set seeded as plugin-owned `fields`,
 *   - `surveyjs` and `gpxMap` rows in `styles`, both stamped with
 *     `id_plugins`,
 *   - `rel_fields_styles` links wiring every field to its style,
 *   - eight plugin permissions stamped with `id_plugins` and linked
 *     to the host `admin` role via `rel_permissions_roles`.
 *
 * All names follow host AGENTS.md DB rules: plural lowercase_snake_case
 * tables, `id_<plural_target_table>` foreign keys,
 * `pk_/fk_/idx_/uq_<table>_<column>` constraint names.
 *
 * `down()` deletes only rows it owns (matched by `id_plugins` on
 * shared CMS rows or by the seeded names) and drops only the six
 * plugin-owned tables. Existing core data is untouched.
 */
final class Version20260522063620 extends AbstractMigration
{
    private const PLUGIN_ID = 'sh2-shp-survey-js';

    private const STYLE_GROUP_NAME = 'Plugin: SurveyJS';

    /** @var array<int, array{name: string, description: string}> */
    private const PERMISSIONS = [
        ['name' => 'surveyjs.surveys.manage',           'description' => 'Create, edit, publish, delete surveys.'],
        ['name' => 'surveyjs.surveys.view-responses',   'description' => 'View survey responses + dashboard.'],
        ['name' => 'surveyjs.surveys.export-pdf',       'description' => 'Export survey responses as PDF.'],
        ['name' => 'surveyjs.surveys.delete-responses', 'description' => 'Delete individual survey responses (admin only).'],
        ['name' => 'surveyjs.surveys.export-csv',       'description' => 'Export survey responses as CSV.'],
        ['name' => 'surveyjs.surveys.export-xlsx',      'description' => 'Export survey responses as Excel (XLSX).'],
        ['name' => 'surveyjs.surveys.export-json',      'description' => 'Export survey responses as JSON.'],
        ['name' => 'surveyjs.surveys.upload-files',     'description' => 'Upload files (GPX / microphone / image) attached to public survey submissions.'],
    ];

    /** @var array<int, array{name: string, position: int}> */
    private const FIELD_TYPES = [
        ['name' => 'select-survey-js',       'position' => 8],
        ['name' => 'select-survey-js-theme', 'position' => 8],
    ];

    /**
     * Plugin-owned fields seeded as `id_plugins`-stamped rows.
     *
     * `display=0` = internal (not translatable). `display=1` = external
     * (translatable, surfaced in the Mantine field editor with locale
     * awareness — used for the markdown labels shown to end users).
     *
     * `config` is a JSON blob baked into `fields.config`. Static select
     * options live there; the dynamic SurveyJS selector is handled by
     * the host field renderer through the `select-survey-js` field type.
     *
     * @var array<int, array{name: string, type: string, display: int, config: ?array}>
     */
    private const FIELDS = [
        ['name' => 'survey-js', 'type' => 'select-survey-js', 'display' => 0, 'config' => null],
        [
            'name'    => 'survey-js-theme',
            'type'    => 'select',
            'display' => 0,
            'config'  => [
                'searchable' => false,
                'clearable'  => false,
                'options'    => [
                    ['value' => 'default',       'text' => 'Default'],
                    ['value' => 'modern',        'text' => 'Modern'],
                    ['value' => 'high-contrast', 'text' => 'High contrast'],
                ],
            ],
        ],
        ['name' => 'restart_on_refresh',      'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'once_per_user',           'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'once_per_schedule',       'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'save_pdf',                'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'close_modal_at_end',      'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'url_params',              'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'start_time',              'type' => 'time',            'display' => 0, 'config' => null],
        ['name' => 'end_time',                'type' => 'time',            'display' => 0, 'config' => null],
        ['name' => 'redirect_at_end',         'type' => 'text',            'display' => 0, 'config' => null],
        ['name' => 'auto_save_interval',      'type' => 'number',          'display' => 0, 'config' => null],
        ['name' => 'label_survey_done',       'type' => 'markdown-inline', 'display' => 1, 'config' => null],
        ['name' => 'label_survey_not_active', 'type' => 'markdown-inline', 'display' => 1, 'config' => null],
        ['name' => 'timeout',                 'type' => 'number',          'display' => 0, 'config' => null],
        ['name' => 'dynamic_replacement',     'type' => 'json',            'display' => 0, 'config' => null],
        ['name' => 'own_entries_only',        'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'data_config',             'type' => 'json',            'display' => 0, 'config' => null],
        ['name' => 'allow_anonymous',         'type' => 'checkbox',        'display' => 0, 'config' => null],
        ['name' => 'sample_points',           'type' => 'json',            'display' => 0, 'config' => null],
    ];

    /** @var array<int, array{name: string, description: string}> */
    private const STYLES = [
        ['name' => 'surveyjs', 'description' => 'Embeds a published SurveyJS survey at runtime.'],
        ['name' => 'gpxMap',   'description' => 'Standalone Leaflet-based map renderer for a GPX answer field.'],
    ];

    /**
     * Per-style field bindings + help text. The first entry per style
     * is the "owner" of the survey selector; the rest configure
     * runtime behaviour. Field rows whose name is in
     * {@see self::FIELDS} are plugin-owned; `css`, `css_mobile` and
     * `condition` are reused from the host catalogue.
     *
     * @var array<int, array{
     *     style: string,
     *     field: string,
     *     default: ?string,
     *     help: string,
     *     hidden: int,
     *     title: ?string
     * }>
     */
    private const STYLE_FIELDS = [
        // surveyjs
        [
            'style' => 'surveyjs', 'field' => 'survey-js', 'default' => '',
            'help'  => 'Select the SurveyJS survey to render on this section. The section stores the survey id and the runtime resolves the published survey key automatically.',
            'hidden' => 0, 'title' => 'Survey',
        ],
        [
            'style' => 'surveyjs', 'field' => 'survey-js-theme', 'default' => 'default',
            'help'  => 'Select a SurveyJS theme from the drop-down list. Themes come from the `surveyJsTheme` lookup.',
            'hidden' => 0, 'title' => 'Theme',
        ],
        [
            'style' => 'surveyjs', 'field' => 'restart_on_refresh', 'default' => '0',
            'help'  => 'If checked the survey is restarted on every page refresh.',
            'hidden' => 0, 'title' => 'Restart on Refresh',
        ],
        [
            'style' => 'surveyjs', 'field' => 'once_per_schedule', 'default' => '0',
            'help'  => 'If checked the survey can be done at most once per active schedule window. Ignored when `once_per_user` is checked.',
            'hidden' => 0, 'title' => 'Once Per Schedule',
        ],
        [
            'style' => 'surveyjs', 'field' => 'once_per_user', 'default' => '0',
            'help'  => 'If checked the survey can be done only once per user. Overrides `once_per_schedule`.',
            'hidden' => 0, 'title' => 'Once Per User',
        ],
        [
            'style' => 'surveyjs', 'field' => 'save_pdf', 'default' => '0',
            'help'  => 'If checked, the user can download the completed survey as a PDF.',
            'hidden' => 0, 'title' => 'Save as PDF',
        ],
        [
            'style' => 'surveyjs', 'field' => 'start_time', 'default' => '00:00',
            'help'  => 'Start time when the survey becomes available.',
            'hidden' => 0, 'title' => 'Start Time',
        ],
        [
            'style' => 'surveyjs', 'field' => 'end_time', 'default' => '00:00',
            'help'  => 'End time when the survey is no longer available.',
            'hidden' => 0, 'title' => 'End Time',
        ],
        [
            'style' => 'surveyjs', 'field' => 'label_survey_done', 'default' => null,
            'help'  => 'Markdown shown when the survey is already completed and `once_per_*` blocks a re-run.',
            'hidden' => 0, 'title' => 'Label — Survey Done',
        ],
        [
            'style' => 'surveyjs', 'field' => 'label_survey_not_active', 'default' => null,
            'help'  => 'Markdown shown when the survey is outside its `start_time` / `end_time` window.',
            'hidden' => 0, 'title' => 'Label — Survey Not Active',
        ],
        [
            'style' => 'surveyjs', 'field' => 'close_modal_at_end', 'default' => '0',
            'help'  => '`Mobile only` — if selected the modal hosting the survey closes once the survey is completed.',
            'hidden' => 0, 'title' => 'Close Modal At End',
        ],
        [
            'style' => 'surveyjs', 'field' => 'redirect_at_end', 'default' => null,
            'help'  => 'Redirect to this URL once the survey is submitted.',
            'hidden' => 0, 'title' => 'Redirect At End',
        ],
        [
            'style' => 'surveyjs', 'field' => 'auto_save_interval', 'default' => '0',
            'help'  => 'If higher than 0, the runtime auto-saves the survey every N seconds.',
            'hidden' => 0, 'title' => 'Auto-Save Interval (s)',
        ],
        [
            'style' => 'surveyjs', 'field' => 'url_params', 'default' => '0',
            'help'  => 'If enabled, query-string parameters are passed into the survey (e.g. `?par1=2&par2=3`).',
            'hidden' => 0, 'title' => 'URL Parameters',
        ],
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
        // host-shared fields reused at the bottom of every style
        [
            'style' => 'surveyjs', 'field' => 'condition', 'default' => null,
            'help'  => 'Optional JSON-Logic condition. The style is rendered only when the condition resolves to true.',
            'hidden' => 0, 'title' => 'Condition',
        ],
        [
            'style' => 'surveyjs', 'field' => 'css', 'default' => null,
            'help'  => 'CSS classes appended to the root element on web.',
            'hidden' => 0, 'title' => 'CSS',
        ],
        [
            'style' => 'surveyjs', 'field' => 'css_mobile', 'default' => null,
            'help'  => 'CSS classes appended to the root element on mobile.',
            'hidden' => 0, 'title' => 'CSS (Mobile)',
        ],

        // gpxMap
        [
            'style' => 'gpxMap', 'field' => 'sample_points', 'default' => null,
            'help'  => 'Inline GPX sample points or a reference to a GPX answer field (`{{question_name}}`). Renders the polyline on the Leaflet map.',
            'hidden' => 0, 'title' => 'Sample Points',
        ],
        [
            'style' => 'gpxMap', 'field' => 'css', 'default' => null,
            'help'  => 'CSS classes appended to the map container on web.',
            'hidden' => 0, 'title' => 'CSS',
        ],
        [
            'style' => 'gpxMap', 'field' => 'css_mobile', 'default' => null,
            'help'  => 'CSS classes appended to the map container on mobile.',
            'hidden' => 0, 'title' => 'CSS (Mobile)',
        ],
        [
            'style' => 'gpxMap', 'field' => 'condition', 'default' => null,
            'help'  => 'Optional JSON-Logic condition. The map renders only when the condition resolves to true.',
            'hidden' => 0, 'title' => 'Condition',
        ],
    ];

    public function getDescription(): string
    {
        return 'sh2-shp-survey-js consolidated install — schema (surveys, survey_versions, survey_runs, survey_answer_links, survey_response_drafts, survey_files) + style group, styles, fields, field types, field-style links, permissions linked to admin role.';
    }

    public function up(Schema $schema): void
    {
        $this->createPluginTables();
        $this->seedStyleGroup();
        $this->seedFieldTypes();
        $this->seedPermissions();
        $this->stampPermissions();
        $this->linkPermissionsToAdminRole();
        $this->seedThemeLookups();
        $this->seedFields();
        $this->seedStyles();
        $this->seedStyleFields();
    }

    public function down(Schema $schema): void
    {
        // Reverse the registration in the opposite order, then drop the
        // plugin tables. Each DELETE is scoped by `id_plugins` or by
        // the seeded name so existing CMS rows are never affected.

        // 1. Unlink permissions from admin role.
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'DELETE rpr FROM rel_permissions_roles rpr '
                . 'INNER JOIN permissions p ON p.id = rpr.id_permissions '
                . 'INNER JOIN roles r ON r.id = rpr.id_roles '
                . 'WHERE p.name = :name AND r.name = :role',
                ['name' => $perm['name'], 'role' => 'admin'],
            );
        }

        // 2. rel_fields_styles is dropped via styles CASCADE below.
        // 3. Plugin-owned styles (CASCADE drops rel_fields_styles).
        $this->addSql(
            'DELETE s FROM styles s '
            . 'INNER JOIN plugins p ON p.id = s.id_plugins '
            . 'WHERE p.plugin_id = :plugin_id',
            ['plugin_id' => self::PLUGIN_ID],
        );

        // 4. Plugin-owned fields.
        $this->addSql(
            'DELETE f FROM fields f '
            . 'INNER JOIN plugins p ON p.id = f.id_plugins '
            . 'WHERE p.plugin_id = :plugin_id',
            ['plugin_id' => self::PLUGIN_ID],
        );

        // 5. New field types (only if no field still references them).
        foreach (self::FIELD_TYPES as $ft) {
            $this->addSql(
                'DELETE ft FROM field_types ft '
                . 'WHERE ft.name = :name '
                . 'AND NOT EXISTS (SELECT 1 FROM fields f WHERE f.id_field_types = ft.id)',
                ['name' => $ft['name']],
            );
        }

        // 6. Style group (only if empty).
        $this->addSql(
            'DELETE sg FROM style_groups sg '
            . 'WHERE sg.name = :name '
            . 'AND NOT EXISTS (SELECT 1 FROM styles s WHERE s.id_style_groups = sg.id)',
            ['name' => self::STYLE_GROUP_NAME],
        );

        // 7. Theme lookups + permissions.
        $this->addSql("DELETE FROM lookups WHERE type_code = 'surveyJsTheme'");
        foreach (self::PERMISSIONS as $perm) {
            $this->addSql(
                'DELETE FROM permissions WHERE name = :name',
                ['name' => $perm['name']],
            );
        }

        // 8. Plugin-owned tables. Drop in reverse FK order so cascading
        //    deletes do not fight with explicit DROPs.
        $this->addSql('DROP TABLE IF EXISTS survey_files');
        $this->addSql('DROP TABLE IF EXISTS survey_response_drafts');
        $this->addSql('ALTER TABLE surveys DROP FOREIGN KEY fk_surveys_current_survey_versions');
        $this->addSql('DROP TABLE IF EXISTS survey_answer_links');
        $this->addSql('DROP TABLE IF EXISTS survey_runs');
        $this->addSql('DROP TABLE IF EXISTS survey_versions');
        $this->addSql('DROP TABLE IF EXISTS surveys');
    }

    private function createPluginTables(): void
    {
        $this->addSql(<<<'SQL'
            CREATE TABLE surveys (
                id INT AUTO_INCREMENT NOT NULL,
                survey_id VARCHAR(100) NOT NULL,
                name VARCHAR(255) NOT NULL,
                theme_code VARCHAR(64) DEFAULT NULL,
                archived TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                updated_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                draft_definition JSON DEFAULT NULL,
                draft_definition_sha256 VARCHAR(64) DEFAULT NULL,
                draft_updated_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
                draft_updated_by_user_id INT DEFAULT NULL,
                id_current_survey_versions INT DEFAULT NULL,
                UNIQUE INDEX uq_surveys_survey_id (survey_id),
                INDEX idx_surveys_survey_id (survey_id),
                INDEX idx_surveys_draft_updated_at (draft_updated_at),
                CONSTRAINT pk_surveys PRIMARY KEY (id)
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_versions (
                id INT AUTO_INCREMENT NOT NULL,
                id_surveys INT NOT NULL,
                revision INT NOT NULL,
                definition JSON NOT NULL,
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                id_created_by_users INT DEFAULT NULL,
                definition_sha256 VARCHAR(64) NOT NULL,
                INDEX idx_survey_versions_surveys (id_surveys),
                UNIQUE INDEX uq_survey_versions_surveys_revision (id_surveys, revision),
                CONSTRAINT pk_survey_versions PRIMARY KEY (id),
                CONSTRAINT fk_survey_versions_surveys
                    FOREIGN KEY (id_surveys) REFERENCES surveys (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            ALTER TABLE surveys
                ADD CONSTRAINT fk_surveys_current_survey_versions
                    FOREIGN KEY (id_current_survey_versions)
                    REFERENCES survey_versions (id) ON DELETE SET NULL
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_runs (
                id INT AUTO_INCREMENT NOT NULL,
                response_id VARCHAR(100) NOT NULL,
                id_surveys INT NOT NULL,
                id_survey_versions INT NOT NULL,
                id_users INT DEFAULT NULL,
                visitor_id VARCHAR(64) DEFAULT NULL,
                id_data_rows INT DEFAULT NULL,
                status VARCHAR(32) NOT NULL,
                started_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                completed_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
                progress JSON DEFAULT NULL,
                UNIQUE INDEX uq_survey_runs_response_id (response_id),
                INDEX idx_survey_runs_response_id (response_id),
                INDEX idx_survey_runs_surveys (id_surveys),
                INDEX idx_survey_runs_survey_versions (id_survey_versions),
                INDEX idx_survey_runs_data_rows (id_data_rows),
                INDEX idx_survey_runs_users (id_users),
                INDEX idx_survey_runs_surveys_visitor (id_surveys, visitor_id),
                CONSTRAINT pk_survey_runs PRIMARY KEY (id),
                CONSTRAINT fk_survey_runs_surveys
                    FOREIGN KEY (id_surveys) REFERENCES surveys (id) ON DELETE CASCADE,
                CONSTRAINT fk_survey_runs_survey_versions
                    FOREIGN KEY (id_survey_versions) REFERENCES survey_versions (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_answer_links (
                id INT AUTO_INCREMENT NOT NULL,
                id_survey_runs INT NOT NULL,
                question_name VARCHAR(191) NOT NULL,
                question_type VARCHAR(64) NOT NULL,
                answer_value LONGTEXT NOT NULL,
                sanitized_html TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_survey_answer_links_survey_runs (id_survey_runs),
                UNIQUE INDEX uq_survey_answer_links_survey_runs_question_name (id_survey_runs, question_name),
                CONSTRAINT pk_survey_answer_links PRIMARY KEY (id),
                CONSTRAINT fk_survey_answer_links_survey_runs
                    FOREIGN KEY (id_survey_runs) REFERENCES survey_runs (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_response_drafts (
                id INT AUTO_INCREMENT NOT NULL,
                response_id VARCHAR(100) NOT NULL,
                id_surveys INT NOT NULL,
                id_survey_versions INT NOT NULL,
                id_users INT DEFAULT NULL,
                visitor_id VARCHAR(64) DEFAULT NULL,
                payload JSON NOT NULL,
                page_no INT NOT NULL DEFAULT 0,
                last_saved_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                expires_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                UNIQUE INDEX uq_survey_drafts_response_id (response_id),
                INDEX idx_survey_drafts_surveys (id_surveys),
                INDEX idx_survey_drafts_surveys_users (id_surveys, id_users),
                INDEX idx_survey_drafts_surveys_visitor (id_surveys, visitor_id),
                INDEX idx_survey_drafts_expires_at (expires_at),
                CONSTRAINT pk_survey_response_drafts PRIMARY KEY (id),
                CONSTRAINT fk_survey_drafts_surveys
                    FOREIGN KEY (id_surveys) REFERENCES surveys (id) ON DELETE CASCADE,
                CONSTRAINT fk_survey_drafts_survey_versions
                    FOREIGN KEY (id_survey_versions) REFERENCES survey_versions (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_files (
                id INT AUTO_INCREMENT NOT NULL,
                id_surveys INT NOT NULL,
                id_survey_runs INT DEFAULT NULL,
                id_survey_response_drafts INT DEFAULT NULL,
                response_id VARCHAR(100) NOT NULL,
                question_name VARCHAR(191) NOT NULL,
                original_filename VARCHAR(255) NOT NULL,
                mime_type VARCHAR(128) NOT NULL,
                size_bytes INT NOT NULL,
                storage_path VARCHAR(512) NOT NULL,
                sha256 VARCHAR(64) NOT NULL,
                uploaded_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                uploaded_by_user_id INT DEFAULT NULL,
                uploaded_by_visitor_id VARCHAR(64) DEFAULT NULL,
                INDEX idx_survey_files_response_id (response_id),
                INDEX idx_survey_files_survey_runs (id_survey_runs),
                INDEX idx_survey_files_survey_drafts (id_survey_response_drafts),
                INDEX idx_survey_files_sha256 (sha256),
                CONSTRAINT pk_survey_files PRIMARY KEY (id),
                CONSTRAINT fk_survey_files_surveys
                    FOREIGN KEY (id_surveys) REFERENCES surveys (id) ON DELETE CASCADE,
                CONSTRAINT fk_survey_files_survey_runs
                    FOREIGN KEY (id_survey_runs) REFERENCES survey_runs (id) ON DELETE SET NULL,
                CONSTRAINT fk_survey_files_survey_response_drafts
                    FOREIGN KEY (id_survey_response_drafts) REFERENCES survey_response_drafts (id) ON DELETE SET NULL
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);
    }

    private function seedStyleGroup(): void
    {
        // Position 900 keeps the plugin group at the bottom of the
        // Add-Section picker, after the host built-in groups (which
        // top out around position 110 in the legacy seed dump).
        $this->addSql(
            'INSERT INTO style_groups (name, description, position) '
            . 'VALUES (:name, :description, :position) '
            . 'ON DUPLICATE KEY UPDATE description = VALUES(description), position = VALUES(position)',
            [
                'name'        => self::STYLE_GROUP_NAME,
                'description' => 'Styles contributed by the SurveyJS plugin (sh2-shp-survey-js). Place a `surveyjs` section to embed a published survey.',
                'position'    => 900,
            ],
        );
    }

    private function seedFieldTypes(): void
    {
        foreach (self::FIELD_TYPES as $ft) {
            $this->addSql(
                'INSERT IGNORE INTO field_types (name, position) VALUES (:name, :position)',
                ['name' => $ft['name'], 'position' => $ft['position']],
            );
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

    /**
     * Stamp the seeded permissions with the plugin's `id_plugins` so the
     * host PluginPurger removes them on uninstall.
     */
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

    private function seedThemeLookups(): void
    {
        $entries = [
            ['code' => 'default',       'value' => 'Default',       'description' => 'Mantine-bridged default theme.'],
            ['code' => 'modern',        'value' => 'Modern',        'description' => null],
            ['code' => 'high-contrast', 'value' => 'High contrast', 'description' => null],
        ];
        foreach ($entries as $entry) {
            $this->addSql(
                "INSERT INTO lookups (type_code, lookup_code, lookup_value, lookup_description) "
                . "VALUES ('surveyJsTheme', :code, :value, :description) "
                . 'ON DUPLICATE KEY UPDATE lookup_value = VALUES(lookup_value), lookup_description = VALUES(lookup_description)',
                ['code' => $entry['code'], 'value' => $entry['value'], 'description' => $entry['description']],
            );
        }
    }

    private function seedFields(): void
    {
        foreach (self::FIELDS as $field) {
            // INSERT … SELECT pattern resolves both `id_field_types`
            // (from the seeded type name) and `id_plugins` (from the
            // host `plugins` row PluginInstaller created before this
            // migration) atomically — no PHP-side state needed.
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

    private function seedStyles(): void
    {
        foreach (self::STYLES as $style) {
            $this->addSql(
                'INSERT IGNORE INTO styles (name, id_style_groups, can_have_children, description, id_plugins) '
                . 'SELECT :name, sg.id, 0, :description, pl.id '
                . 'FROM style_groups sg, plugins pl '
                . 'WHERE sg.name = :group_name AND pl.plugin_id = :plugin_id',
                [
                    'name'        => $style['name'],
                    'description' => $style['description'],
                    'group_name'  => self::STYLE_GROUP_NAME,
                    'plugin_id'   => self::PLUGIN_ID,
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

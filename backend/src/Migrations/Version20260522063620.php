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
 * SurveyJS plugin initial schema.
 *
 * Creates the four plugin-owned tables:
 *   - `surveys`              survey aggregate root.
 *   - `survey_versions`      immutable definition snapshots.
 *   - `survey_runs`          submission metadata, FK into core `data_rows`.
 *   - `survey_answer_links`  per-question link into core `data_cells`.
 *
 * All names follow the host AGENTS.md DB rules:
 *   - plural lowercase_snake_case table names;
 *   - `id_<plural_target_table>` foreign-key columns
 *     (`id_surveys`, `id_survey_versions`, `id_users`, `id_data_rows`,
 *      `id_data_cells`, `id_survey_runs`,
 *      `id_current_survey_versions`, `id_created_by_users`);
 *   - `pk_/fk_/idx_/uq_<plural_table>_<column>` constraint names.
 *
 * Seeds the plugin's permissions (`surveyjs.surveys.manage`,
 * `surveyjs.surveys.view-responses`, `surveyjs.surveys.export-pdf`)
 * and the `surveyJsTheme` lookup contributions.
 *
 * `down()` is declared safe: drops only the plugin-owned tables and
 * the seeded rows. Existing core data is untouched.
 */
final class Version20260522063620 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'sh2-shp-survey-js initial schema (surveys, survey_versions, survey_runs, survey_answer_links) + permissions + surveyJsTheme lookups.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
            CREATE TABLE surveys (
                id INT AUTO_INCREMENT NOT NULL,
                id_plugins INT DEFAULT NULL,
                name VARCHAR(255) NOT NULL,
                key_slug VARCHAR(191) NOT NULL,
                theme_code VARCHAR(64) DEFAULT NULL,
                archived TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                updated_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                id_current_survey_versions INT DEFAULT NULL,
                UNIQUE INDEX uq_surveys_key_slug (key_slug),
                INDEX idx_surveys_key_slug (key_slug),
                INDEX idx_surveys_id_plugins (id_plugins),
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
                id_surveys INT NOT NULL,
                id_survey_versions INT NOT NULL,
                id_users INT DEFAULT NULL,
                id_data_rows INT DEFAULT NULL,
                status VARCHAR(32) NOT NULL,
                started_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                completed_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
                progress JSON DEFAULT NULL,
                INDEX idx_survey_runs_surveys (id_surveys),
                INDEX idx_survey_runs_survey_versions (id_survey_versions),
                INDEX idx_survey_runs_data_rows (id_data_rows),
                INDEX idx_survey_runs_users (id_users),
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
                id_data_cells INT DEFAULT NULL,
                sanitized_html TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_survey_answer_links_survey_runs (id_survey_runs),
                INDEX idx_survey_answer_links_data_cells (id_data_cells),
                UNIQUE INDEX uq_survey_answer_links_survey_runs_question_name (id_survey_runs, question_name),
                CONSTRAINT pk_survey_answer_links PRIMARY KEY (id),
                CONSTRAINT fk_survey_answer_links_survey_runs
                    FOREIGN KEY (id_survey_runs) REFERENCES survey_runs (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->seedPermissions();
        $this->seedLookups();
    }

    public function down(Schema $schema): void
    {
        $this->addSql("DELETE FROM lookups WHERE type_code = 'surveyJsTheme'");
        $this->addSql("DELETE FROM permissions WHERE name IN ('surveyjs.surveys.manage', 'surveyjs.surveys.view-responses', 'surveyjs.surveys.export-pdf')");
        $this->addSql('ALTER TABLE surveys DROP FOREIGN KEY fk_surveys_current_survey_versions');
        $this->addSql('DROP TABLE IF EXISTS survey_answer_links');
        $this->addSql('DROP TABLE IF EXISTS survey_runs');
        $this->addSql('DROP TABLE IF EXISTS survey_versions');
        $this->addSql('DROP TABLE IF EXISTS surveys');
    }

    private function seedPermissions(): void
    {
        foreach ([
            ['name' => 'surveyjs.surveys.manage', 'description' => 'Create, edit, publish, delete surveys.'],
            ['name' => 'surveyjs.surveys.view-responses', 'description' => 'View survey responses + dashboard.'],
            ['name' => 'surveyjs.surveys.export-pdf', 'description' => 'Export survey responses as PDF.'],
        ] as $perm) {
            $this->addSql(
                "INSERT INTO permissions (name, description) VALUES (:name, :description) ON DUPLICATE KEY UPDATE description = VALUES(description)",
                ['name' => $perm['name'], 'description' => $perm['description']],
            );
        }
    }

    private function seedLookups(): void
    {
        $entries = [
            ['code' => 'default', 'value' => 'Default', 'description' => 'Mantine-bridged default theme.'],
            ['code' => 'modern', 'value' => 'Modern', 'description' => null],
            ['code' => 'high-contrast', 'value' => 'High contrast', 'description' => null],
        ];
        foreach ($entries as $entry) {
            $this->addSql(
                "INSERT INTO lookups (type_code, lookup_code, lookup_value, lookup_description) VALUES ('surveyJsTheme', :code, :value, :description) ON DUPLICATE KEY UPDATE lookup_value = VALUES(lookup_value), lookup_description = VALUES(lookup_description)",
                ['code' => $entry['code'], 'value' => $entry['value'], 'description' => $entry['description']],
            );
        }
    }
}

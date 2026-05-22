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
 *   - `survey`             - survey aggregate root.
 *   - `survey_version`     - immutable definition snapshots.
 *   - `survey_run`         - submission metadata, FK into core `data_rows`.
 *   - `survey_answer_link` - per-question link into core `data_cells`.
 *
 * Seeds the plugin's permissions (`surveyjs.surveys.manage`,
 * `surveyjs.surveys.view-responses`, `surveyjs.surveys.export-pdf`)
 * and the `surveyJsTheme` lookup contributions.
 *
 * `down()` is declared safe - it drops only the plugin-owned tables
 * and the seeded rows. Existing core data is untouched.
 */
final class Version20260522063620 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'sh2-shp-survey-js initial schema (Survey, SurveyVersion, SurveyRun, SurveyAnswerLink) + permissions + surveyJsTheme lookups.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql(<<<'SQL'
            CREATE TABLE survey (
                id INT AUTO_INCREMENT NOT NULL,
                id_plugins INT DEFAULT NULL,
                name VARCHAR(255) NOT NULL,
                key_slug VARCHAR(191) NOT NULL,
                theme_code VARCHAR(64) DEFAULT NULL,
                archived TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                updated_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                id_current_version INT DEFAULT NULL,
                UNIQUE INDEX uq_survey_key_slug (key_slug),
                INDEX idx_survey_key_slug (key_slug),
                PRIMARY KEY (id)
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_version (
                id INT AUTO_INCREMENT NOT NULL,
                id_survey INT NOT NULL,
                revision INT NOT NULL,
                definition JSON NOT NULL,
                created_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                created_by_user_id INT DEFAULT NULL,
                definition_sha256 VARCHAR(64) NOT NULL,
                INDEX idx_survey_version_survey (id_survey),
                UNIQUE INDEX uq_survey_version_revision (id_survey, revision),
                PRIMARY KEY (id),
                CONSTRAINT fk_survey_version_survey FOREIGN KEY (id_survey) REFERENCES survey (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            ALTER TABLE survey
                ADD CONSTRAINT fk_survey_current_version FOREIGN KEY (id_current_version)
                    REFERENCES survey_version (id) ON DELETE SET NULL
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_run (
                id INT AUTO_INCREMENT NOT NULL,
                id_survey INT NOT NULL,
                id_survey_version INT NOT NULL,
                id_user INT DEFAULT NULL,
                id_data_row INT DEFAULT NULL,
                status VARCHAR(32) NOT NULL,
                started_at DATETIME NOT NULL COMMENT '(DC2Type:datetime_immutable)',
                completed_at DATETIME DEFAULT NULL COMMENT '(DC2Type:datetime_immutable)',
                progress JSON DEFAULT NULL,
                INDEX idx_survey_run_survey (id_survey),
                INDEX idx_survey_run_version (id_survey_version),
                INDEX idx_survey_run_data_row (id_data_row),
                PRIMARY KEY (id),
                CONSTRAINT fk_survey_run_survey FOREIGN KEY (id_survey) REFERENCES survey (id) ON DELETE CASCADE,
                CONSTRAINT fk_survey_run_version FOREIGN KEY (id_survey_version) REFERENCES survey_version (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->addSql(<<<'SQL'
            CREATE TABLE survey_answer_link (
                id INT AUTO_INCREMENT NOT NULL,
                id_survey_run INT NOT NULL,
                question_name VARCHAR(191) NOT NULL,
                question_type VARCHAR(64) NOT NULL,
                id_data_cell INT DEFAULT NULL,
                sanitized_html TINYINT(1) NOT NULL DEFAULT 0,
                INDEX idx_survey_answer_link_run (id_survey_run),
                INDEX idx_survey_answer_link_cell (id_data_cell),
                UNIQUE INDEX uq_survey_answer_link_run_question (id_survey_run, question_name),
                PRIMARY KEY (id),
                CONSTRAINT fk_survey_answer_link_run FOREIGN KEY (id_survey_run) REFERENCES survey_run (id) ON DELETE CASCADE
            ) DEFAULT CHARACTER SET utf8mb4 ENGINE = InnoDB
        SQL);

        $this->seedPermissions();
        $this->seedLookups();
    }

    public function down(Schema $schema): void
    {
        $this->addSql("DELETE FROM lookups WHERE type_code = 'surveyJsTheme'");
        $this->addSql("DELETE FROM permissions WHERE name IN ('surveyjs.surveys.manage', 'surveyjs.surveys.view-responses', 'surveyjs.surveys.export-pdf')");
        $this->addSql('ALTER TABLE survey DROP FOREIGN KEY fk_survey_current_version');
        $this->addSql('DROP TABLE IF EXISTS survey_answer_link');
        $this->addSql('DROP TABLE IF EXISTS survey_run');
        $this->addSql('DROP TABLE IF EXISTS survey_version');
        $this->addSql('DROP TABLE IF EXISTS survey');
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

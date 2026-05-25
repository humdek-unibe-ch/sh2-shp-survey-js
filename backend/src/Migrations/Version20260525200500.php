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
 * Phase 1 follow-up: adds plugin-owned tables for per-page autosave
 * (`survey_response_drafts`) and secure file uploads (`survey_files`)
 * plus a `visitor_id` column on `survey_runs` so the once-per-user
 * guard can dedupe anonymous repeat submissions identified by the
 * signed `_sh_sjs_vid` cookie.
 *
 * `down()` is safe — it only drops the newly-introduced tables /
 * columns / indexes.
 */
final class Version20260525200500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'sh2-shp-survey-js Phase 1.2: survey_response_drafts, survey_files, survey_runs.visitor_id for anonymous once-per-user.';
    }

    public function up(Schema $schema): void
    {
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

        $this->addSql(<<<'SQL'
            ALTER TABLE survey_runs
                ADD COLUMN visitor_id VARCHAR(64) DEFAULT NULL AFTER id_users,
                ADD INDEX idx_survey_runs_surveys_visitor (id_surveys, visitor_id)
        SQL);
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE survey_runs DROP INDEX idx_survey_runs_surveys_visitor');
        $this->addSql('ALTER TABLE survey_runs DROP COLUMN visitor_id');
        $this->addSql('DROP TABLE IF EXISTS survey_files');
        $this->addSql('DROP TABLE IF EXISTS survey_response_drafts');
    }
}

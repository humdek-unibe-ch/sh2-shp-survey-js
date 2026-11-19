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
 * Answers in one home (SurveyJS 3 upgrade, wave 5): a response is now only a
 * row of the core data table `sh2_surveyjs_<survey id>`, unfinished or
 * finished. The plugin's copies go: `survey_runs`, `survey_answer_links` and
 * `survey_response_drafts`. Uploads are core form files named in the answer,
 * so `survey_files` goes too.
 *
 * Answers already submitted stay in the data tables. Lost on purpose: the
 * plugin's metadata about them (revision, visitor id), unfinished drafts, and
 * files uploaded before (their rows; the files stay in the old folder).
 * `down()` restores the empty tables, not their rows.
 */
final class Version20261117132938 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'sh2-shp-survey-js: drop survey_runs, survey_answer_links, survey_response_drafts and survey_files; responses and their uploads live in the core data store.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('DROP TABLE survey_files');
        $this->addSql('DROP TABLE survey_answer_links');
        $this->addSql('DROP TABLE survey_runs');
        $this->addSql('DROP TABLE survey_response_drafts');
    }

    public function down(Schema $schema): void
    {
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
}

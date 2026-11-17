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
 * `survey_response_drafts`, and the links of `survey_files` to the first and
 * last of them (a file belongs to its response by `response_id`).
 *
 * Answers already submitted stay in the data tables. Lost on purpose: the
 * plugin's metadata about them (revision, visitor id) and unfinished drafts.
 * `down()` restores the empty tables and columns, not their rows.
 */
final class Version20261117132938 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'sh2-shp-survey-js: drop survey_runs, survey_answer_links, survey_response_drafts and their survey_files links; responses live in the core data store.';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE survey_files DROP FOREIGN KEY fk_survey_files_survey_runs');
        $this->addSql('ALTER TABLE survey_files DROP FOREIGN KEY fk_survey_files_survey_response_drafts');
        $this->addSql('DROP INDEX idx_survey_files_survey_runs ON survey_files');
        $this->addSql('DROP INDEX idx_survey_files_survey_drafts ON survey_files');
        $this->addSql('ALTER TABLE survey_files DROP COLUMN id_survey_runs, DROP COLUMN id_survey_response_drafts');
        $this->addSql('CREATE INDEX idx_survey_files_uploaded_by_user ON survey_files (uploaded_by_user_id)');

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

        $this->addSql('DROP INDEX idx_survey_files_uploaded_by_user ON survey_files');
        $this->addSql('ALTER TABLE survey_files ADD id_survey_runs INT DEFAULT NULL AFTER id_surveys, ADD id_survey_response_drafts INT DEFAULT NULL AFTER id_survey_runs');
        $this->addSql('CREATE INDEX idx_survey_files_survey_runs ON survey_files (id_survey_runs)');
        $this->addSql('CREATE INDEX idx_survey_files_survey_drafts ON survey_files (id_survey_response_drafts)');
        $this->addSql('ALTER TABLE survey_files ADD CONSTRAINT fk_survey_files_survey_runs FOREIGN KEY (id_survey_runs) REFERENCES survey_runs (id) ON DELETE SET NULL');
        $this->addSql('ALTER TABLE survey_files ADD CONSTRAINT fk_survey_files_survey_response_drafts FOREIGN KEY (id_survey_response_drafts) REFERENCES survey_response_drafts (id) ON DELETE SET NULL');
    }
}

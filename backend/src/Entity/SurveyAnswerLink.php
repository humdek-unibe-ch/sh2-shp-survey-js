<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Entity;

use Doctrine\ORM\Mapping as ORM;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;

/**
 * Connects a single SurveyJS question answer to the corresponding row in
 * `data_cells`. The cell holds the actual answer; this row tells the
 * dashboard which cell belongs to which question of which run, and
 * caches the question kind so SQL filters can stay fast.
 */
#[ORM\Entity(repositoryClass: SurveyAnswerLinkRepository::class)]
#[ORM\Table(name: 'survey_answer_link')]
#[ORM\Index(columns: ['id_survey_run'], name: 'idx_survey_answer_link_run')]
#[ORM\Index(columns: ['id_data_cell'], name: 'idx_survey_answer_link_cell')]
#[ORM\UniqueConstraint(name: 'uq_survey_answer_link_run_question', columns: ['id_survey_run', 'question_name'])]
class SurveyAnswerLink
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: SurveyRun::class, inversedBy: 'answerLinks')]
    #[ORM\JoinColumn(name: 'id_survey_run', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private SurveyRun $run;

    #[ORM\Column(name: 'question_name', type: 'string', length: 191)]
    private string $questionName;

    #[ORM\Column(name: 'question_type', type: 'string', length: 64)]
    private string $questionType;

    /** FK into core `data_cells.id`. */
    #[ORM\Column(name: 'id_data_cell', type: 'integer', nullable: true)]
    private ?int $idDataCell = null;

    #[ORM\Column(name: 'sanitized_html', type: 'boolean', options: ['default' => false])]
    private bool $sanitizedHtml = false;

    public function __construct(SurveyRun $run, string $questionName, string $questionType)
    {
        $this->run = $run;
        $this->questionName = $questionName;
        $this->questionType = $questionType;
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getRun(): SurveyRun
    {
        return $this->run;
    }

    public function getQuestionName(): string
    {
        return $this->questionName;
    }

    public function getQuestionType(): string
    {
        return $this->questionType;
    }

    public function getIdDataCell(): ?int
    {
        return $this->idDataCell;
    }

    public function setIdDataCell(?int $idDataCell): self
    {
        $this->idDataCell = $idDataCell;
        return $this;
    }

    public function isSanitizedHtml(): bool
    {
        return $this->sanitizedHtml;
    }

    public function setSanitizedHtml(bool $sanitizedHtml): self
    {
        $this->sanitizedHtml = $sanitizedHtml;
        return $this;
    }
}

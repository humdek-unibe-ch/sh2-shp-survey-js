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
 * Stores a single SurveyJS question answer alongside the run metadata.
 * Core `data_cells` still hold the CMS data-browser copy; this row keeps
 * the plugin dashboard independent from core's composite data-cell key.
 */
#[ORM\Entity(repositoryClass: SurveyAnswerLinkRepository::class)]
#[ORM\Table(name: 'survey_answer_links')]
#[ORM\Index(columns: ['id_survey_runs'], name: 'idx_survey_answer_links_survey_runs')]
#[ORM\UniqueConstraint(name: 'uq_survey_answer_links_survey_runs_question_name', columns: ['id_survey_runs', 'question_name'])]
class SurveyAnswerLink
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: SurveyRun::class, inversedBy: 'answerLinks')]
    #[ORM\JoinColumn(name: 'id_survey_runs', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private SurveyRun $run;

    #[ORM\Column(name: 'question_name', type: 'string', length: 191)]
    private string $questionName;

    #[ORM\Column(name: 'question_type', type: 'string', length: 64)]
    private string $questionType;

    #[ORM\Column(name: 'answer_value', type: 'text')]
    private string $answerValue;

    #[ORM\Column(name: 'sanitized_html', type: 'boolean', options: ['default' => false])]
    private bool $sanitizedHtml = false;

    public function __construct(SurveyRun $run, string $questionName, string $questionType, string $answerValue)
    {
        $this->run = $run;
        $this->questionName = $questionName;
        $this->questionType = $questionType;
        $this->answerValue = $answerValue;
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

    public function getAnswerValue(): string
    {
        return $this->answerValue;
    }

    public function setAnswerValue(string $answerValue): self
    {
        $this->answerValue = $answerValue;
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

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Entity;

use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;

/**
 * One submission of a survey. Links the participant's authentication
 * context (when available) to the version + the rows the answer
 * normalizer wrote into the existing `data_tables` / `data_rows`
 * tables. The actual answer payload lives in `data_cells` — this row
 * is just metadata so the dashboard can query responses without
 * trawling form storage.
 */
#[ORM\Entity(repositoryClass: SurveyRunRepository::class)]
#[ORM\Table(name: 'survey_runs')]
#[ORM\Index(columns: ['id_surveys'], name: 'idx_survey_runs_surveys')]
#[ORM\Index(columns: ['id_survey_versions'], name: 'idx_survey_runs_survey_versions')]
#[ORM\Index(columns: ['id_data_rows'], name: 'idx_survey_runs_data_rows')]
#[ORM\Index(columns: ['response_id'], name: 'idx_survey_runs_response_id')]
class SurveyRun
{
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_INVALID = 'invalid';

    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(name: 'response_id', type: 'string', length: 100, unique: true)]
    private string $responseId;

    #[ORM\ManyToOne(targetEntity: Survey::class, inversedBy: 'runs')]
    #[ORM\JoinColumn(name: 'id_surveys', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private Survey $survey;

    #[ORM\ManyToOne(targetEntity: SurveyVersion::class)]
    #[ORM\JoinColumn(name: 'id_survey_versions', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private SurveyVersion $version;

    #[ORM\Column(name: 'id_users', type: 'integer', nullable: true)]
    private ?int $idUser = null;

    /** Foreign key into core `data_rows.id`. Kept as a plain int because the core repo owns the canonical mapping. */
    #[ORM\Column(name: 'id_data_rows', type: 'integer', nullable: true)]
    private ?int $idDataRow = null;

    #[ORM\Column(name: 'status', type: 'string', length: 32)]
    private string $status;

    #[ORM\Column(name: 'started_at', type: 'datetime_immutable')]
    private DateTimeImmutable $startedAt;

    #[ORM\Column(name: 'completed_at', type: 'datetime_immutable', nullable: true)]
    private ?DateTimeImmutable $completedAt = null;

    /**
     * Lightweight aggregate kept on the run row for the dashboard so the
     * UI can show "X of Y" coverage without querying every cell.
     *
     * @var array<string, mixed>
     */
    #[ORM\Column(name: 'progress', type: 'json', nullable: true)]
    private ?array $progress = null;

    /** @var Collection<int, SurveyAnswerLink> */
    #[ORM\OneToMany(mappedBy: 'run', targetEntity: SurveyAnswerLink::class, cascade: ['persist', 'remove'])]
    private Collection $answerLinks;

    public function __construct(Survey $survey, SurveyVersion $version, string $responseId, ?int $idUser)
    {
        $this->survey = $survey;
        $this->version = $version;
        $this->responseId = $responseId;
        $this->idUser = $idUser;
        $this->status = self::STATUS_IN_PROGRESS;
        $this->startedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->answerLinks = new ArrayCollection();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getSurvey(): Survey
    {
        return $this->survey;
    }

    public function getResponseId(): string
    {
        return $this->responseId;
    }

    public function getVersion(): SurveyVersion
    {
        return $this->version;
    }

    public function getIdUser(): ?int
    {
        return $this->idUser;
    }

    public function getIdDataRow(): ?int
    {
        return $this->idDataRow;
    }

    public function setIdDataRow(?int $idDataRow): self
    {
        $this->idDataRow = $idDataRow;
        return $this;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): self
    {
        if (!in_array($status, [self::STATUS_IN_PROGRESS, self::STATUS_COMPLETED, self::STATUS_INVALID], true)) {
            throw new \InvalidArgumentException(sprintf('Unknown SurveyRun status "%s".', $status));
        }
        $this->status = $status;
        if ($status === self::STATUS_COMPLETED && $this->completedAt === null) {
            $this->completedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        }
        return $this;
    }

    public function getStartedAt(): DateTimeImmutable
    {
        return $this->startedAt;
    }

    public function getCompletedAt(): ?DateTimeImmutable
    {
        return $this->completedAt;
    }

    /** @return array<string, mixed>|null */
    public function getProgress(): ?array
    {
        return $this->progress;
    }

    /** @param array<string, mixed>|null $progress */
    public function setProgress(?array $progress): self
    {
        $this->progress = $progress;
        return $this;
    }

    /** @return Collection<int, SurveyAnswerLink> */
    public function getAnswerLinks(): Collection
    {
        return $this->answerLinks;
    }
}

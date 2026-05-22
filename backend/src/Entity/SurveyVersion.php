<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Entity;

use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;

/**
 * An immutable snapshot of a survey definition. Editing the survey in
 * the Creator produces a draft; publishing creates a new
 * `SurveyVersion` row and updates `Survey::currentVersion` atomically.
 */
#[ORM\Entity(repositoryClass: SurveyVersionRepository::class)]
#[ORM\Table(name: 'survey_version')]
#[ORM\Index(columns: ['id_survey'], name: 'idx_survey_version_survey')]
#[ORM\UniqueConstraint(name: 'uq_survey_version_revision', columns: ['id_survey', 'revision'])]
class SurveyVersion
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Survey::class, inversedBy: 'versions')]
    #[ORM\JoinColumn(name: 'id_survey', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private Survey $survey;

    #[ORM\Column(type: 'integer')]
    private int $revision;

    /**
     * The SurveyJS JSON definition. Kept as `json` so PHPStan can be
     * specific about the structure inside the service layer.
     *
     * @var array<string, mixed>
     */
    #[ORM\Column(type: 'json')]
    private array $definition;

    #[ORM\Column(name: 'created_at', type: 'datetime_immutable')]
    private DateTimeImmutable $createdAt;

    #[ORM\Column(name: 'created_by_user_id', type: 'integer', nullable: true)]
    private ?int $createdByUserId = null;

    #[ORM\Column(name: 'definition_sha256', type: 'string', length: 64)]
    private string $definitionSha256;

    /**
     * @param array<string, mixed> $definition
     */
    public function __construct(Survey $survey, int $revision, array $definition, ?int $createdByUserId)
    {
        $this->survey = $survey;
        $this->revision = $revision;
        $this->definition = $definition;
        $this->createdByUserId = $createdByUserId;
        $this->createdAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->definitionSha256 = hash('sha256', json_encode($definition, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '');
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getSurvey(): Survey
    {
        return $this->survey;
    }

    public function getRevision(): int
    {
        return $this->revision;
    }

    /** @return array<string, mixed> */
    public function getDefinition(): array
    {
        return $this->definition;
    }

    public function getCreatedAt(): DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getCreatedByUserId(): ?int
    {
        return $this->createdByUserId;
    }

    public function getDefinitionSha256(): string
    {
        return $this->definitionSha256;
    }
}

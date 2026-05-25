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
use Humdek\SurveyJsBundle\Repository\SurveyRepository;

/**
 * A survey owned by the plugin. One survey aggregates many published
 * `SurveyVersion` snapshots (one is "current") and many `SurveyRun` rows.
 */
#[ORM\Entity(repositoryClass: SurveyRepository::class)]
#[ORM\Table(name: 'surveys')]
#[ORM\Index(columns: ['survey_id'], name: 'idx_surveys_survey_id')]
class Survey
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(name: 'survey_id', type: 'string', length: 100, unique: true)]
    private string $surveyId;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(name: 'theme_code', type: 'string', length: 64, nullable: true)]
    private ?string $themeCode = null;

    #[ORM\Column(type: 'boolean', options: ['default' => false])]
    private bool $archived = false;

    #[ORM\Column(name: 'created_at', type: 'datetime_immutable')]
    private DateTimeImmutable $createdAt;

    #[ORM\Column(name: 'updated_at', type: 'datetime_immutable')]
    private DateTimeImmutable $updatedAt;

    /** @var array<string, mixed>|null */
    #[ORM\Column(name: 'draft_definition', type: 'json', nullable: true)]
    private ?array $draftDefinition = null;

    #[ORM\Column(name: 'draft_definition_sha256', type: 'string', length: 64, nullable: true)]
    private ?string $draftDefinitionSha256 = null;

    #[ORM\Column(name: 'draft_updated_at', type: 'datetime_immutable', nullable: true)]
    private ?DateTimeImmutable $draftUpdatedAt = null;

    #[ORM\Column(name: 'draft_updated_by_user_id', type: 'integer', nullable: true)]
    private ?int $draftUpdatedByUserId = null;

    #[ORM\ManyToOne(targetEntity: SurveyVersion::class)]
    #[ORM\JoinColumn(name: 'id_current_survey_versions', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?SurveyVersion $currentVersion = null;

    /** @var Collection<int, SurveyVersion> */
    #[ORM\OneToMany(mappedBy: 'survey', targetEntity: SurveyVersion::class, cascade: ['remove'])]
    private Collection $versions;

    /** @var Collection<int, SurveyRun> */
    #[ORM\OneToMany(mappedBy: 'survey', targetEntity: SurveyRun::class, cascade: ['remove'])]
    private Collection $runs;

    /**
     * @param array<string, mixed> $draftDefinition
     */
    public function __construct(string $name, string $surveyId, array $draftDefinition = [])
    {
        $this->name = $name;
        $this->surveyId = $surveyId;
        $this->createdAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->updatedAt = $this->createdAt;
        $this->setDraftDefinition($draftDefinition, null);
        $this->versions = new ArrayCollection();
        $this->runs = new ArrayCollection();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getSurveyId(): string
    {
        return $this->surveyId;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): self
    {
        $this->name = $name;
        $this->touch();
        return $this;
    }

    public function getThemeCode(): ?string
    {
        return $this->themeCode;
    }

    public function setThemeCode(?string $themeCode): self
    {
        $this->themeCode = $themeCode;
        $this->touch();
        return $this;
    }

    public function isArchived(): bool
    {
        return $this->archived;
    }

    public function setArchived(bool $archived): self
    {
        $this->archived = $archived;
        $this->touch();
        return $this;
    }

    public function getCurrentVersion(): ?SurveyVersion
    {
        return $this->currentVersion;
    }

    public function setCurrentVersion(?SurveyVersion $version): self
    {
        $this->currentVersion = $version;
        $this->touch();
        return $this;
    }

    /** @return array<string, mixed>|null */
    public function getDraftDefinition(): ?array
    {
        return $this->draftDefinition;
    }

    /**
     * @param array<string, mixed> $definition
     */
    public function setDraftDefinition(array $definition, ?int $userId): self
    {
        $this->draftDefinition = $definition;
        $this->draftDefinitionSha256 = self::hashDefinition($definition);
        $this->draftUpdatedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->draftUpdatedByUserId = $userId;
        $this->touch();
        return $this;
    }

    public function getDraftDefinitionSha256(): ?string
    {
        return $this->draftDefinitionSha256;
    }

    public function getDraftUpdatedAt(): ?DateTimeImmutable
    {
        return $this->draftUpdatedAt;
    }

    public function getDraftUpdatedByUserId(): ?int
    {
        return $this->draftUpdatedByUserId;
    }

    public function getCreatedAt(): DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUpdatedAt(): DateTimeImmutable
    {
        return $this->updatedAt;
    }

    /** @return Collection<int, SurveyVersion> */
    public function getVersions(): Collection
    {
        return $this->versions;
    }

    /** @return Collection<int, SurveyRun> */
    public function getRuns(): Collection
    {
        return $this->runs;
    }

    private function touch(): void
    {
        $this->updatedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    /**
     * @param array<string, mixed> $definition
     */
    public static function hashDefinition(array $definition): string
    {
        return hash('sha256', json_encode($definition, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '');
    }
}

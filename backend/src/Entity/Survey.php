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
#[ORM\Index(columns: ['key_slug'], name: 'idx_surveys_key_slug')]
class Survey
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(name: 'id_plugins', type: 'integer', nullable: true)]
    private ?int $idPlugins = null;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    /** Public slug used in the public submit URL: /cms-api/v1/plugins/sh2-shp-survey-js/published/{key} */
    #[ORM\Column(name: 'key_slug', type: 'string', length: 191, unique: true)]
    private string $keySlug;

    #[ORM\Column(name: 'theme_code', type: 'string', length: 64, nullable: true)]
    private ?string $themeCode = null;

    #[ORM\Column(type: 'boolean', options: ['default' => false])]
    private bool $archived = false;

    #[ORM\Column(name: 'created_at', type: 'datetime_immutable')]
    private DateTimeImmutable $createdAt;

    #[ORM\Column(name: 'updated_at', type: 'datetime_immutable')]
    private DateTimeImmutable $updatedAt;

    #[ORM\ManyToOne(targetEntity: SurveyVersion::class)]
    #[ORM\JoinColumn(name: 'id_current_survey_versions', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?SurveyVersion $currentVersion = null;

    /** @var Collection<int, SurveyVersion> */
    #[ORM\OneToMany(mappedBy: 'survey', targetEntity: SurveyVersion::class, cascade: ['remove'])]
    private Collection $versions;

    /** @var Collection<int, SurveyRun> */
    #[ORM\OneToMany(mappedBy: 'survey', targetEntity: SurveyRun::class, cascade: ['remove'])]
    private Collection $runs;

    public function __construct(string $name, string $keySlug)
    {
        $this->name = $name;
        $this->keySlug = $keySlug;
        $this->createdAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->updatedAt = $this->createdAt;
        $this->versions = new ArrayCollection();
        $this->runs = new ArrayCollection();
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getIdPlugins(): ?int
    {
        return $this->idPlugins;
    }

    public function setIdPlugins(?int $idPlugins): self
    {
        $this->idPlugins = $idPlugins;
        return $this;
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

    public function getKeySlug(): string
    {
        return $this->keySlug;
    }

    public function setKeySlug(string $keySlug): self
    {
        $this->keySlug = $keySlug;
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
}

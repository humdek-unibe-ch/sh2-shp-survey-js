<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Entity;

use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;

/**
 * In-progress survey response. Mirrors the legacy plugin's
 * page-by-page auto-save behaviour: the runtime PUTs the partially
 * filled SurveyJS state every `auto_save_interval` seconds (and on
 * every page change). On completion the row is promoted into a
 * `SurveyRun` and deleted.
 *
 * Identity is keyed by `response_id` so the URL `?responseId=...`
 * can resume a draft across devices. Authenticated drafts are also
 * tracked by `id_users`; anonymous drafts use the signed visitor
 * cookie (`visitor_id`) so unauthenticated participants get the same
 * "resume where you left off" experience without conflating their
 * sessions.
 */
#[ORM\Entity(repositoryClass: SurveyResponseDraftRepository::class)]
#[ORM\Table(name: 'survey_response_drafts')]
#[ORM\Index(columns: ['id_surveys'], name: 'idx_survey_drafts_surveys')]
#[ORM\Index(columns: ['id_surveys', 'id_users'], name: 'idx_survey_drafts_surveys_users')]
#[ORM\Index(columns: ['id_surveys', 'visitor_id'], name: 'idx_survey_drafts_surveys_visitor')]
#[ORM\Index(columns: ['expires_at'], name: 'idx_survey_drafts_expires_at')]
class SurveyResponseDraft
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(name: 'response_id', type: 'string', length: 100, unique: true)]
    private string $responseId;

    #[ORM\ManyToOne(targetEntity: Survey::class)]
    #[ORM\JoinColumn(name: 'id_surveys', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private Survey $survey;

    #[ORM\ManyToOne(targetEntity: SurveyVersion::class)]
    #[ORM\JoinColumn(name: 'id_survey_versions', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private SurveyVersion $version;

    #[ORM\Column(name: 'id_users', type: 'integer', nullable: true)]
    private ?int $idUser = null;

    #[ORM\Column(name: 'visitor_id', type: 'string', length: 64, nullable: true)]
    private ?string $visitorId = null;

    /**
     * Full SurveyJS state: `data` (answers), current page index, locale,
     * URL params snapshot, started_at and any client-side meta the
     * runtime wants to round-trip.
     *
     * @var array<string, mixed>
     */
    #[ORM\Column(type: 'json')]
    private array $payload;

    #[ORM\Column(name: 'page_no', type: 'integer', options: ['default' => 0])]
    private int $pageNo = 0;

    #[ORM\Column(name: 'last_saved_at', type: 'datetime_immutable')]
    private DateTimeImmutable $lastSavedAt;

    #[ORM\Column(name: 'created_at', type: 'datetime_immutable')]
    private DateTimeImmutable $createdAt;

    #[ORM\Column(name: 'expires_at', type: 'datetime_immutable')]
    private DateTimeImmutable $expiresAt;

    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        Survey $survey,
        SurveyVersion $version,
        string $responseId,
        ?int $idUser,
        ?string $visitorId,
        array $payload,
        int $pageNo,
        DateTimeImmutable $expiresAt,
    ) {
        $this->survey = $survey;
        $this->version = $version;
        $this->responseId = $responseId;
        $this->idUser = $idUser;
        $this->visitorId = $visitorId;
        $this->payload = $payload;
        $this->pageNo = $pageNo;
        $this->expiresAt = $expiresAt;
        $now = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $this->createdAt = $now;
        $this->lastSavedAt = $now;
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getResponseId(): string
    {
        return $this->responseId;
    }

    public function getSurvey(): Survey
    {
        return $this->survey;
    }

    public function getVersion(): SurveyVersion
    {
        return $this->version;
    }

    public function getIdUser(): ?int
    {
        return $this->idUser;
    }

    public function getVisitorId(): ?string
    {
        return $this->visitorId;
    }

    /** @return array<string, mixed> */
    public function getPayload(): array
    {
        return $this->payload;
    }

    /** @param array<string, mixed> $payload */
    public function setPayload(array $payload): self
    {
        $this->payload = $payload;
        $this->lastSavedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
        return $this;
    }

    public function getPageNo(): int
    {
        return $this->pageNo;
    }

    public function setPageNo(int $pageNo): self
    {
        $this->pageNo = $pageNo;
        return $this;
    }

    public function getLastSavedAt(): DateTimeImmutable
    {
        return $this->lastSavedAt;
    }

    public function getCreatedAt(): DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getExpiresAt(): DateTimeImmutable
    {
        return $this->expiresAt;
    }

    public function extendExpiry(DateTimeImmutable $expiresAt): self
    {
        $this->expiresAt = $expiresAt;
        return $this;
    }
}

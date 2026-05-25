<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Entity;

use DateTimeImmutable;
use Doctrine\ORM\Mapping as ORM;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;

/**
 * Metadata for a file uploaded via a SurveyJS file / GPX / microphone
 * question.
 *
 * Files live OUTSIDE the web root under
 * `var/plugin-data/sh2-shp-survey-js/uploads/<surveyId>/<responseId>/<questionName>/<sha256>.<ext>`.
 * Only the relative path is recorded here; the {@see \Humdek\SurveyJsBundle\Service\SurveyFileStorage}
 * service resolves it to the absolute path and the {@see \Humdek\SurveyJsBundle\Service\SignedFileUrlService}
 * produces short-lived signed download URLs.
 *
 * The row is linked to either an in-progress draft (`id_survey_drafts`)
 * or a completed run (`id_survey_runs`). When a draft is promoted to a
 * run on completion the link is rewritten so the file stays attached
 * to its run.
 *
 * `uploaded_by_user_id` OR `uploaded_by_visitor_id` records the
 * uploader identity so the download endpoint can authorise the
 * original uploader without leaking files to other survey
 * participants.
 */
#[ORM\Entity(repositoryClass: SurveyFileRepository::class)]
#[ORM\Table(name: 'survey_files')]
#[ORM\Index(columns: ['response_id'], name: 'idx_survey_files_response_id')]
#[ORM\Index(columns: ['id_survey_runs'], name: 'idx_survey_files_survey_runs')]
#[ORM\Index(columns: ['id_survey_response_drafts'], name: 'idx_survey_files_survey_drafts')]
#[ORM\Index(columns: ['sha256'], name: 'idx_survey_files_sha256')]
class SurveyFile
{
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: Survey::class)]
    #[ORM\JoinColumn(name: 'id_surveys', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private Survey $survey;

    #[ORM\ManyToOne(targetEntity: SurveyRun::class)]
    #[ORM\JoinColumn(name: 'id_survey_runs', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?SurveyRun $run = null;

    #[ORM\ManyToOne(targetEntity: SurveyResponseDraft::class)]
    #[ORM\JoinColumn(name: 'id_survey_response_drafts', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?SurveyResponseDraft $draft = null;

    #[ORM\Column(name: 'response_id', type: 'string', length: 100)]
    private string $responseId;

    #[ORM\Column(name: 'question_name', type: 'string', length: 191)]
    private string $questionName;

    #[ORM\Column(name: 'original_filename', type: 'string', length: 255)]
    private string $originalFilename;

    #[ORM\Column(name: 'mime_type', type: 'string', length: 128)]
    private string $mimeType;

    #[ORM\Column(name: 'size_bytes', type: 'integer')]
    private int $sizeBytes;

    /**
     * Relative path under the plugin's uploads directory. Storing the
     * relative form keeps the rows portable across hosts (the absolute
     * root is resolved at runtime by {@see SurveyFileStorage}).
     */
    #[ORM\Column(name: 'storage_path', type: 'string', length: 512)]
    private string $storagePath;

    #[ORM\Column(name: 'sha256', type: 'string', length: 64)]
    private string $sha256;

    #[ORM\Column(name: 'uploaded_at', type: 'datetime_immutable')]
    private DateTimeImmutable $uploadedAt;

    #[ORM\Column(name: 'uploaded_by_user_id', type: 'integer', nullable: true)]
    private ?int $uploadedByUserId = null;

    #[ORM\Column(name: 'uploaded_by_visitor_id', type: 'string', length: 64, nullable: true)]
    private ?string $uploadedByVisitorId = null;

    public function __construct(
        Survey $survey,
        string $responseId,
        string $questionName,
        string $originalFilename,
        string $mimeType,
        int $sizeBytes,
        string $storagePath,
        string $sha256,
        ?int $uploadedByUserId,
        ?string $uploadedByVisitorId,
    ) {
        $this->survey = $survey;
        $this->responseId = $responseId;
        $this->questionName = $questionName;
        $this->originalFilename = $originalFilename;
        $this->mimeType = $mimeType;
        $this->sizeBytes = $sizeBytes;
        $this->storagePath = $storagePath;
        $this->sha256 = $sha256;
        $this->uploadedByUserId = $uploadedByUserId;
        $this->uploadedByVisitorId = $uploadedByVisitorId;
        $this->uploadedAt = new DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getSurvey(): Survey
    {
        return $this->survey;
    }

    public function getRun(): ?SurveyRun
    {
        return $this->run;
    }

    public function setRun(?SurveyRun $run): self
    {
        $this->run = $run;
        return $this;
    }

    public function getDraft(): ?SurveyResponseDraft
    {
        return $this->draft;
    }

    public function setDraft(?SurveyResponseDraft $draft): self
    {
        $this->draft = $draft;
        return $this;
    }

    public function getResponseId(): string
    {
        return $this->responseId;
    }

    public function getQuestionName(): string
    {
        return $this->questionName;
    }

    public function getOriginalFilename(): string
    {
        return $this->originalFilename;
    }

    public function getMimeType(): string
    {
        return $this->mimeType;
    }

    public function getSizeBytes(): int
    {
        return $this->sizeBytes;
    }

    public function getStoragePath(): string
    {
        return $this->storagePath;
    }

    public function getSha256(): string
    {
        return $this->sha256;
    }

    public function getUploadedAt(): DateTimeImmutable
    {
        return $this->uploadedAt;
    }

    public function getUploadedByUserId(): ?int
    {
        return $this->uploadedByUserId;
    }

    public function getUploadedByVisitorId(): ?string
    {
        return $this->uploadedByVisitorId;
    }

    /**
     * Authorisation predicate used by the download endpoint. The caller
     * is the uploader when either the authenticated user id matches
     * `uploaded_by_user_id` OR the anonymous visitor id matches
     * `uploaded_by_visitor_id`. Admins (callers with
     * `surveyjs.surveys.view-responses`) are checked separately at the
     * controller layer.
     */
    public function isOwnedBy(?int $userId, ?string $visitorId): bool
    {
        if ($userId !== null && $this->uploadedByUserId === $userId) {
            return true;
        }
        if ($visitorId !== null && $visitorId !== '' && $this->uploadedByVisitorId === $visitorId) {
            return true;
        }
        return false;
    }
}

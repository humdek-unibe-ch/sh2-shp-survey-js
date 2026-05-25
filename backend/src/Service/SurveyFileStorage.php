<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Exception\SurveyFileException;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Symfony\Component\HttpFoundation\File\UploadedFile;

/**
 * Filesystem-backed storage for SurveyJS file / GPX / microphone
 * questions.
 *
 * Files land OUTSIDE the web root under
 * `<plugin_data_dir>/uploads/<surveyId>/<responseId>/<questionName>/<sha256>.<ext>`.
 * The base directory comes from the env `SURVEYJS_UPLOAD_DIR`; when
 * unset we fall back to `<project>/var/plugin-data/sh2-shp-survey-js/uploads`.
 *
 * Deduplication is done by SHA-256: re-uploading the same content
 * for the same `(response_id, question_name)` only ever produces one
 * row + one on-disk blob.
 *
 * MIME / size limits come from env (`SURVEYJS_UPLOAD_MAX_BYTES`,
 * default 25 MB). The allow-list is intentionally permissive so the
 * Creator's question authoring stays flexible — the host's host-wide
 * upload policies (CSP, AV scan, etc.) still apply.
 */
class SurveyFileStorage
{
    private const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

    private const ALLOWED_MIME_PREFIXES = [
        'image/',
        'audio/',
        'video/',
        'application/pdf',
        'application/json',
        'application/gpx+xml',
        'application/octet-stream',
        'application/xml',
        'text/',
    ];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyFileRepository $files,
        private readonly string $uploadDir,
        private readonly int $maxBytes = self::DEFAULT_MAX_BYTES,
    ) {
    }

    public function upload(
        Survey $survey,
        string $responseId,
        string $questionName,
        UploadedFile $file,
        ?SurveyResponseDraft $draft,
        ?SurveyRun $run,
        ?int $userId,
        ?string $visitorId,
    ): SurveyFile {
        $this->validateUpload($file);

        $sha = hash_file('sha256', $file->getPathname()) ?: '';
        if ($sha === '') {
            throw new SurveyFileException(SurveyFileException::REASON_STORAGE, 'Failed to hash uploaded file.');
        }

        $existing = $this->files->findOneByResponseAndQuestion($responseId, $questionName, $sha);
        if ($existing instanceof SurveyFile && file_exists($this->resolvePath($existing))) {
            return $existing;
        }

        $extension = $this->safeExtension($file);
        $relative = sprintf(
            '%s/%s/%s/%s%s',
            $this->sanitizeSegment($survey->getSurveyId()),
            $this->sanitizeSegment($responseId),
            $this->sanitizeSegment($questionName),
            $sha,
            $extension !== '' ? ('.' . $extension) : '',
        );
        $absolute = $this->absolutePath($relative);
        $dir = dirname($absolute);
        if (!is_dir($dir) && !@mkdir($dir, 0o755, true) && !is_dir($dir)) {
            throw new SurveyFileException(SurveyFileException::REASON_STORAGE, sprintf('Failed to create upload directory "%s".', $dir));
        }
        if (!@copy($file->getPathname(), $absolute)) {
            throw new SurveyFileException(SurveyFileException::REASON_STORAGE, sprintf('Failed to persist upload to "%s".', $absolute));
        }

        $entity = new SurveyFile(
            $survey,
            $responseId,
            $questionName,
            (string) ($file->getClientOriginalName() ?: ('upload' . ($extension !== '' ? '.' . $extension : ''))),
            (string) ($file->getClientMimeType() ?: $file->getMimeType() ?: 'application/octet-stream'),
            (int) ($file->getSize() ?: filesize($absolute) ?: 0),
            $relative,
            $sha,
            $userId,
            $visitorId,
        );
        if ($draft !== null) {
            $entity->setDraft($draft);
        }
        if ($run !== null) {
            $entity->setRun($run);
        }
        $this->em->persist($entity);
        $this->em->flush();
        return $entity;
    }

    public function delete(SurveyFile $file): void
    {
        $absolute = $this->resolvePath($file);
        if (is_file($absolute) && !@unlink($absolute)) {
            // Failure to remove a missing/locked file is non-fatal —
            // we still drop the row so the participant's view stays
            // consistent. An operator can sweep orphans later.
        }
        $this->em->remove($file);
        $this->em->flush();
    }

    public function resolvePath(SurveyFile $file): string
    {
        return $this->absolutePath($file->getStoragePath());
    }

    public function getMaxBytes(): int
    {
        return $this->maxBytes;
    }

    /**
     * Attach all files belonging to the supplied draft to the freshly
     * created run + clear the draft pointer so the next promotion does
     * not double-attach.
     */
    public function promoteDraftFilesToRun(SurveyResponseDraft $draft, SurveyRun $run): void
    {
        foreach ($this->files->findByDraft($draft) as $file) {
            $file->setRun($run);
            $file->setDraft(null);
        }
        $this->em->flush();
    }

    private function validateUpload(UploadedFile $file): void
    {
        if (!$file->isValid()) {
            throw new SurveyFileException(SurveyFileException::REASON_INVALID, sprintf('Upload error code %d (%s).', $file->getError(), $file->getErrorMessage()));
        }
        $size = (int) ($file->getSize() ?: 0);
        if ($size <= 0) {
            throw new SurveyFileException(SurveyFileException::REASON_INVALID, 'Uploaded file is empty.');
        }
        if ($size > $this->maxBytes) {
            throw new SurveyFileException(
                SurveyFileException::REASON_TOO_LARGE,
                sprintf('Uploaded file %d bytes exceeds %d bytes limit.', $size, $this->maxBytes),
            );
        }
        $mime = (string) ($file->getClientMimeType() ?: $file->getMimeType() ?: '');
        if (!$this->isMimeAllowed($mime)) {
            throw new SurveyFileException(
                SurveyFileException::REASON_MIME_NOT_ALLOWED,
                sprintf('Mime type "%s" is not allowed.', $mime),
            );
        }
    }

    private function isMimeAllowed(string $mime): bool
    {
        if ($mime === '') {
            return false;
        }
        foreach (self::ALLOWED_MIME_PREFIXES as $prefix) {
            if (str_starts_with($mime, $prefix)) {
                return true;
            }
        }
        return false;
    }

    private function absolutePath(string $relative): string
    {
        return rtrim($this->uploadDir, "/\\") . DIRECTORY_SEPARATOR . ltrim($relative, "/\\");
    }

    /**
     * Trim path traversal characters; restrict to a conservative
     * filename-safe alphabet so user input cannot poison the storage
     * tree even when SurveyJS lets question names contain spaces.
     */
    private function sanitizeSegment(string $value): string
    {
        $value = preg_replace('/[^A-Za-z0-9._-]/', '_', $value) ?? '';
        $value = trim($value, '._');
        return $value === '' ? 'unknown' : $value;
    }

    private function safeExtension(UploadedFile $file): string
    {
        $extension = strtolower((string) $file->getClientOriginalExtension());
        if ($extension === '' && $file->guessExtension() !== null) {
            $extension = strtolower((string) $file->guessExtension());
        }
        $extension = preg_replace('/[^a-z0-9]/', '', $extension) ?? '';
        return $extension;
    }
}

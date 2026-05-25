<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Exception;

/**
 * Raised when the survey-file pipeline rejects an upload / download
 * request. The reason discriminator lets the public controller map
 * each case to the right HTTP status and the runtime to the right
 * localised message.
 */
final class SurveyFileException extends \RuntimeException
{
    public const REASON_TOO_LARGE = 'file_too_large';
    public const REASON_MIME_NOT_ALLOWED = 'file_mime_not_allowed';
    public const REASON_INVALID = 'file_invalid';
    public const REASON_NOT_FOUND = 'file_not_found';
    public const REASON_FORBIDDEN = 'file_forbidden';
    public const REASON_SIGNATURE_INVALID = 'file_signature_invalid';
    public const REASON_SIGNATURE_EXPIRED = 'file_signature_expired';
    public const REASON_STORAGE = 'file_storage_error';

    public function __construct(
        public readonly string $reason,
        string $message,
    ) {
        parent::__construct($message);
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Exception;

/**
 * Thrown by {@see \Humdek\SurveyJsBundle\Service\SurveyResponseService::submit()}
 * when a server-side guard (`once_per_user`, schedule-window, …)
 * refuses to persist another response.
 *
 * The controller maps it to a 409 Conflict — the runtime expects this
 * status and either re-renders the "already submitted" view or shows a
 * blocking notice. The reason code lets the UI pick a stable
 * translation key without parsing the message.
 */
final class SurveySubmissionRejectedException extends \RuntimeException
{
    public const REASON_ONCE_PER_USER = 'already_submitted_once';
    public const REASON_WINDOW_EXHAUSTED = 'already_submitted_in_window';
    public const REASON_AUTH_REQUIRED = 'authentication_required';

    /**
     * Edit-mode submit referenced a responseId that does not exist
     * for this survey. Mapped to HTTP 404 by the public controller.
     */
    public const REASON_EDIT_NOT_FOUND = 'edit_target_not_found';

    /**
     * Edit-mode submit referenced an existing response not owned by
     * the caller (different user id and different visitor cookie).
     * Mapped to HTTP 403 by the public controller.
     */
    public const REASON_EDIT_FORBIDDEN = 'edit_forbidden';

    public function __construct(
        public readonly string $reason,
        string $message,
    ) {
        parent::__construct($message);
    }
}

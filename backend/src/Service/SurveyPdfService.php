<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * PDF export of survey responses.
 *
 * Status: stub. PDF export is gated by the `pdf-export` feature flag
 * (default OFF) and the `surveyjs.surveys.export-pdf` permission. The
 * real renderer will use SurveyJS Survey PDF (commercial) plus the
 * Tiptap rich-text adapter for HTML question rendering — both still
 * pending licensing review. Until then this service responds with a
 * 501 so the admin UI can surface the gating clearly instead of
 * pretending the endpoint is wired.
 *
 * Replace `renderResponse()` with the actual PDF generation once the
 * renderer is selected; the controller signature is intentionally
 * narrow (Symfony `Response` return) so a stream/buffer swap-in is
 * straightforward.
 */
final class SurveyPdfService
{
    public function renderResponse(Survey $survey, SurveyRun $run): Response
    {
        return new JsonResponse(
            [
                'error' => 'PDF export is not yet implemented.',
                'reason' => 'pdf-export feature flag default is off; renderer pending.',
                'id' => $survey->getId(),
                'surveyId' => $survey->getSurveyId(),
                'runId' => $run->getId(),
                'responseId' => $run->getResponseId(),
            ],
            Response::HTTP_NOT_IMPLEMENTED,
        );
    }
}

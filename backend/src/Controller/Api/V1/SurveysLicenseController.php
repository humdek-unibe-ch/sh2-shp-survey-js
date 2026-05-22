<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;

/**
 * Admin-only endpoint that returns the SurveyJS license key from the
 * configured environment so the admin Survey Designer can apply it.
 *
 * The host's `ApiSecurityListener` ensures only callers with
 * `surveyjs.surveys.manage` reach this controller; we additionally
 * scrub the response when the key is empty to avoid handing out an
 * empty token that would mislead admins.
 */
#[AsController]
final class SurveysLicenseController
{
    public function __construct(
        private readonly ?string $licenseKey,
    ) {
    }

    public function __invoke(): JsonResponse
    {
        if ($this->licenseKey === null || $this->licenseKey === '') {
            return new JsonResponse(['data' => ['licenseKey' => null, 'configured' => false]]);
        }
        return new JsonResponse(['data' => ['licenseKey' => $this->licenseKey, 'configured' => true]]);
    }
}

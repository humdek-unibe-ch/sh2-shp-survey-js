<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;

/**
 * Health endpoint surfaced both for the plugin doctor command and
 * for the admin Plugins detail page Health tab.
 */
#[AsController]
final class SurveysHealthController
{
    public function __construct(
        private readonly SurveyJsHealthCheck $check,
    ) {
    }

    public function __invoke(): JsonResponse
    {
        return new JsonResponse(['data' => $this->check->check()]);
    }
}

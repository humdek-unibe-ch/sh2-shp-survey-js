<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Attribute\AsController;

/**
 * Public Surveys API used by the runtime `surveyjs` style.
 *
 * Both endpoints accept the stable generated `survey_id` shown in the
 * admin UI. The internal numeric id stays limited to admin routes.
 */
#[AsController]
final class SurveysPublicController
{
    public function __construct(
        private readonly SurveyRepository $surveys,
        private readonly SurveyResponseService $responseService,
    ) {
    }

    public function published(string $key): JsonResponse
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            return new JsonResponse(['error' => 'No published version.'], 404);
        }
        return new JsonResponse(['data' => [
            'surveyId' => $survey->getSurveyId(),
            'name' => $survey->getName(),
            'themeCode' => $survey->getThemeCode(),
            'revision' => $version->getRevision(),
            'definition' => $version->getDefinition(),
        ]]);
    }

    public function submit(string $key, Request $request): JsonResponse
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = json_decode($request->getContent(), true);
        $answers = is_array($body['answers'] ?? null) ? $body['answers'] : null;
        if (!is_array($answers)) {
            return new JsonResponse(['error' => 'answers required.'], 422);
        }
        $enforce = is_array($body['enforce'] ?? null) ? $body['enforce'] : [];
        $payload = $request->attributes->get('_jwt_payload');
        $userId = is_array($payload) && isset($payload['id_users']) ? (int) $payload['id_users'] : null;

        try {
            $run = $this->responseService->submit($survey, $answers, $userId, $enforce);
        } catch (SurveySubmissionRejectedException $e) {
            // 401 when the section requires authentication for once-per-user /
            // schedule-window enforcement, 409 when the survey was already
            // submitted in the relevant scope. The `reason` discriminator lets
            // the runtime pick a stable translation key.
            $status = $e->reason === SurveySubmissionRejectedException::REASON_AUTH_REQUIRED ? 401 : 409;
            return new JsonResponse([
                'error' => $e->getMessage(),
                'reason' => $e->reason,
            ], $status);
        }

        return new JsonResponse(['data' => [
            'runId' => $run->getId(),
            'responseId' => $run->getResponseId(),
            'submittedAt' => ($run->getCompletedAt() ?? $run->getStartedAt())->format(DATE_ATOM),
        ]], 201);
    }

    private function resolveSurvey(string $key): ?Survey
    {
        return $this->surveys->findOneBySurveyId($key);
    }
}

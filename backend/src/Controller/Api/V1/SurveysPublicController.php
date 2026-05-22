<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Attribute\AsController;

/**
 * Public Surveys API used by the runtime `surveyjs` style.
 *
 * Both endpoints accept the survey's `keySlug` instead of the
 * numeric id so the public URL stays stable across DB rebuilds and
 * the SurveyJS style can embed the slug literally.
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
        $survey = $this->surveys->findOneByKeySlug($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            return new JsonResponse(['error' => 'No published version.'], 404);
        }
        return new JsonResponse(['data' => [
            'surveyId' => $survey->getId(),
            'keySlug' => $survey->getKeySlug(),
            'name' => $survey->getName(),
            'themeCode' => $survey->getThemeCode(),
            'revision' => $version->getRevision(),
            'definition' => $version->getDefinition(),
        ]]);
    }

    public function submit(string $key, Request $request): JsonResponse
    {
        $survey = $this->surveys->findOneByKeySlug($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = json_decode($request->getContent(), true);
        $answers = is_array($body['answers'] ?? null) ? $body['answers'] : null;
        if (!is_array($answers)) {
            return new JsonResponse(['error' => 'answers required.'], 422);
        }
        $userId = $request->attributes->getInt('jwt_user_id') ?: null;
        $run = $this->responseService->submit($survey, $answers, $userId);
        return new JsonResponse(['data' => [
            'runId' => $run->getId(),
            'submittedAt' => ($run->getCompletedAt() ?? $run->getStartedAt())->format(DATE_ATOM),
        ]], 201);
    }
}

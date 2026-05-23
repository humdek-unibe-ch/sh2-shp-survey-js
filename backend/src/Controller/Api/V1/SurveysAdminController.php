<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyPdfService;
use Humdek\SurveyJsBundle\Service\SurveyService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;

/**
 * Admin Surveys API.
 *
 * Wired through manifest-declared routes (host's `ApiRouteLoader`
 * resolves them at runtime). Permission gating is enforced by the
 * host `ApiSecurityListener`; this controller does NOT re-check
 * permissions.
 */
#[AsController]
final class SurveysAdminController
{
    public function __construct(
        private readonly SurveyRepository $surveys,
        private readonly SurveyRunRepository $runs,
        private readonly SurveyService $surveyService,
        private readonly SurveyDashboardService $dashboardService,
        private readonly SurveyPdfService $pdfService,
    ) {
    }

    public function list(): JsonResponse
    {
        $items = $this->surveys->findAllActive();
        return new JsonResponse([
            'data' => array_map(fn (Survey $survey) => $this->summarize($survey), $items),
        ]);
    }

    public function create(Request $request): JsonResponse
    {
        $body = $this->decode($request);
        $name = (string) ($body['name'] ?? '');
        $keySlug = (string) ($body['keySlug'] ?? '');
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : [];
        $userId = $request->attributes->getInt('jwt_user_id') ?: null;
        if ($name === '' || $keySlug === '') {
            return new JsonResponse(['error' => 'name and keySlug are required.'], 422);
        }
        $survey = $this->surveyService->createSurvey($name, $keySlug, $definition, $userId);
        return new JsonResponse(['data' => $this->summarize($survey)], 201);
    }

    public function get(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        return new JsonResponse(['data' => $this->detail($survey)]);
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        if (isset($body['name'])) {
            $survey->setName((string) $body['name']);
        }
        if (array_key_exists('themeCode', $body)) {
            $themeCode = $body['themeCode'];
            $survey->setThemeCode($themeCode === null ? null : (string) $themeCode);
        }
        if (isset($body['archived'])) {
            $survey->setArchived((bool) $body['archived']);
        }
        $this->surveyService->archive($survey, $survey->isArchived());
        return new JsonResponse(['data' => $this->summarize($survey)]);
    }

    public function delete(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $this->surveyService->delete($survey);
        return new JsonResponse(['data' => ['deleted' => true]]);
    }

    public function publishVersion(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : [];
        if ($definition === []) {
            return new JsonResponse(['error' => 'definition required.'], 422);
        }
        $userId = $request->attributes->getInt('jwt_user_id') ?: null;
        $version = $this->surveyService->publishNewVersion($survey, $definition, $userId);
        return new JsonResponse(['data' => [
            'surveyId' => $survey->getId(),
            'revision' => $version->getRevision(),
            'createdAt' => $version->getCreatedAt()->format(DATE_ATOM),
        ]]);
    }

    public function dashboard(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        return new JsonResponse(['data' => $this->dashboardService->buildSummary($survey)]);
    }

    /**
     * List responses for a survey. Used by the admin Responses tab.
     *
     * Paginated; default page=1, limit=50. The full answer payload is
     * NOT inlined here — clients should follow `/responses/{rid}` (when
     * implemented) for the answer cells.
     */
    public function responses(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }

        $page = max(1, (int) $request->query->get('page', 1));
        $limit = min(200, max(1, (int) $request->query->get('limit', 50)));
        $offset = ($page - 1) * $limit;

        $items = $this->runs->findRecentForSurvey($survey, $limit, $offset);
        $total = $this->runs->countForSurvey($survey);

        return new JsonResponse([
            'data' => [
                'items' => array_map(static fn($run) => [
                    'id' => $run->getId(),
                    'surveyId' => $survey->getId(),
                    'revision' => $run->getVersion()->getRevision(),
                    'userId' => $run->getIdUser(),
                    'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
                    'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                    'status' => $run->getStatus(),
                ], $items),
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
            ],
        ]);
    }

    /**
     * PDF export of a single survey response. Gated by the
     * `surveyjs.surveys.export-pdf` permission and the `pdf-export`
     * feature flag (off by default). The actual rendering is delegated
     * to `SurveyPdfService`, which currently returns a 501 stub —
     * implementation follows the PDF question's roadmap.
     */
    public function responsePdf(int $id, int $rid): Response
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $run = $this->runs->find($rid);
        if ($run === null || $run->getSurvey()->getId() !== $survey->getId()) {
            return new JsonResponse(['error' => 'Response not found.'], 404);
        }

        return $this->pdfService->renderResponse($survey, $run);
    }

    /**
     * @return array<string, mixed>
     */
    private function summarize(Survey $survey): array
    {
        return [
            'id' => $survey->getId(),
            'name' => $survey->getName(),
            'keySlug' => $survey->getKeySlug(),
            'themeCode' => $survey->getThemeCode(),
            'archived' => $survey->isArchived(),
            'updatedAt' => $survey->getUpdatedAt()->format(DATE_ATOM),
            'currentRevision' => $survey->getCurrentVersion()?->getRevision(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Survey $survey): array
    {
        return [
            ...$this->summarize($survey),
            'definition' => $survey->getCurrentVersion()?->getDefinition(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decode(Request $request): array
    {
        $raw = $request->getContent();
        if ($raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}

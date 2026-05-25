<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
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
        private readonly SurveyVersionRepository $versions,
        private readonly SurveyAnswerLinkRepository $answerLinks,
        private readonly SurveyService $surveyService,
        private readonly SurveyDashboardService $dashboardService,
        private readonly SurveyPdfService $pdfService,
        private readonly SurveyJsRealtimePublisher $realtime,
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
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : [];
        $userId = $this->userId($request);
        if (trim($name) === '') {
            return new JsonResponse(['error' => 'name is required.'], 422);
        }
        $survey = $this->surveyService->createSurvey(trim($name), $definition, $userId);
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
        $userId = $this->userId($request);
        if (array_key_exists('definition', $body)) {
            if (!is_array($body['definition'])) {
                return new JsonResponse(['error' => 'definition must be an object.'], 422);
            }
            $this->surveyService->saveDraft(
                $survey,
                $this->normaliseSurveyDefinition($body['definition']),
                $this->stringOrNull($body['expectedDraftHash'] ?? null),
                $userId,
                (bool) ($body['force'] ?? false),
            );
        }
        $version = $this->surveyService->publishDraft($survey, $userId);
        return new JsonResponse(['data' => [
            'id' => $survey->getId(),
            'surveyId' => $survey->getSurveyId(),
            'revision' => $version->getRevision(),
            'createdAt' => $version->getCreatedAt()->format(DATE_ATOM),
            'draftHash' => $survey->getDraftDefinitionSha256(),
        ]]);
    }

    public function saveDraft(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : null;
        if (!is_array($definition)) {
            return new JsonResponse(['error' => 'definition required.'], 422);
        }
        try {
            $this->surveyService->saveDraft(
                $survey,
                $this->normaliseSurveyDefinition($definition),
                $this->stringOrNull($body['expectedDraftHash'] ?? null),
                $this->userId($request),
                (bool) ($body['force'] ?? false),
            );
        } catch (\DomainException $e) {
            if ($e->getCode() === 409) {
                return new JsonResponse([
                    'error' => $e->getMessage(),
                    'data' => $this->detail($survey),
                ], 409);
            }
            throw $e;
        }

        return new JsonResponse(['data' => $this->detail($survey)]);
    }

    public function versions(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        return new JsonResponse(['data' => array_map(
            fn (SurveyVersion $version) => $this->versionSummary($version),
            $this->versions->findForSurvey($survey),
        )]);
    }

    public function restoreVersion(int $id, int $versionId, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        $version = $this->versions->find($versionId);
        if (!$survey instanceof Survey || !$version instanceof SurveyVersion) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $this->surveyService->restoreVersion($survey, $version, $this->userId($request));
        return new JsonResponse(['data' => $this->detail($survey)]);
    }

    public function presence(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        $state = (string) ($body['state'] ?? 'editing');
        if (!in_array($state, ['editing', 'idle', 'left'], true)) {
            return new JsonResponse(['error' => 'Invalid state.'], 422);
        }
        $userId = $this->userId($request);
        if ($userId === null) {
            return new JsonResponse(['error' => 'Authenticated user required.'], 401);
        }
        $this->realtime->surveyEditingPresence($survey, $userId, $this->userName($request, $userId), $state);
        return new JsonResponse(['data' => ['published' => true]]);
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
                    'responseId' => $run->getResponseId(),
                    'surveyId' => $survey->getSurveyId(),
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
    public function responsePdf(int $id, string $rid): Response
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $run = $this->resolveRun($survey, $rid);
        if ($run === null) {
            return new JsonResponse(['error' => 'Response not found.'], 404);
        }

        return $this->pdfService->renderResponse($survey, $run);
    }

    public function responseDetail(int $id, string $rid): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $run = $this->resolveRun($survey, $rid);
        if ($run === null) {
            return new JsonResponse(['error' => 'Response not found.'], 404);
        }

        return new JsonResponse(['data' => [
            'id' => $run->getId(),
            'responseId' => $run->getResponseId(),
            'surveyId' => $survey->getSurveyId(),
            'revision' => $run->getVersion()->getRevision(),
            'userId' => $run->getIdUser(),
            'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
            'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
            'status' => $run->getStatus(),
            'answers' => array_map(static fn ($link) => [
                'questionName' => $link->getQuestionName(),
                'questionType' => $link->getQuestionType(),
                'value' => $link->getAnswerValue(),
                'sanitizedHtml' => $link->isSanitizedHtml(),
            ], $this->answerLinks->findForRun($run)),
        ]]);
    }

    /**
     * @return array<string, mixed>
     */
    private function summarize(Survey $survey): array
    {
        return [
            'id' => $survey->getId(),
            'surveyId' => $survey->getSurveyId(),
            'name' => $survey->getName(),
            'themeCode' => $survey->getThemeCode(),
            'archived' => $survey->isArchived(),
            'updatedAt' => $survey->getUpdatedAt()->format(DATE_ATOM),
            'currentRevision' => $survey->getCurrentVersion()?->getRevision(),
            'draftHash' => $survey->getDraftDefinitionSha256(),
            'draftUpdatedAt' => $survey->getDraftUpdatedAt()?->format(DATE_ATOM),
            'draftUpdatedByUserId' => $survey->getDraftUpdatedByUserId(),
            'responseCount' => $this->runs->countForSurvey($survey),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Survey $survey): array
    {
        return [
            ...$this->summarize($survey),
            'definition' => $survey->getDraftDefinition() ?? $survey->getCurrentVersion()?->getDefinition(),
            'publishedDefinition' => $survey->getCurrentVersion()?->getDefinition(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function versionSummary(SurveyVersion $version): array
    {
        return [
            'id' => $version->getId(),
            'revision' => $version->getRevision(),
            'createdAt' => $version->getCreatedAt()->format(DATE_ATOM),
            'createdByUserId' => $version->getCreatedByUserId(),
            'definitionSha256' => $version->getDefinitionSha256(),
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

    private function userId(Request $request): ?int
    {
        $payload = $request->attributes->get('_jwt_payload');
        if (is_array($payload) && isset($payload['id_users'])) {
            return (int) $payload['id_users'];
        }
        return null;
    }

    private function userName(Request $request, int $fallbackId): string
    {
        $payload = $request->attributes->get('_jwt_payload');
        if (is_array($payload)) {
            foreach (['user_name', 'username', 'email'] as $key) {
                if (isset($payload[$key]) && is_string($payload[$key]) && $payload[$key] !== '') {
                    return $payload[$key];
                }
            }
        }
        return 'User #' . $fallbackId;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    private function resolveRun(Survey $survey, string $rid): ?SurveyRun
    {
        $run = ctype_digit($rid)
            ? $this->runs->find((int) $rid)
            : $this->runs->findOneByResponseId($rid);

        return $run !== null && $run->getSurvey()->getId() === $survey->getId()
            ? $run
            : null;
    }

    /**
     * SurveyJS represents a brand-new blank survey as `{}`. Persist a
     * minimal explicit shape so publish/save flows treat it as a valid
     * empty survey definition instead of a missing request body.
     *
     * @param array<string,mixed> $definition
     * @return array<string,mixed>
     */
    private function normaliseSurveyDefinition(array $definition): array
    {
        return $definition === [] ? ['pages' => []] : $definition;
    }
}

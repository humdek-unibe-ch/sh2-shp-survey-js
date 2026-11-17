<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyPdfService;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use Humdek\SurveyJsBundle\Service\SurveyService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Humdek\SurveyJsBundle\Service\SurveyJsApi;

/**
 * Admin Surveys API.
 *
 * Wired through manifest-declared routes (host's `ApiRouteLoader`
 * resolves them at runtime). The host `ApiSecurityListener` checks the
 * route permission (`surveyjs.survey.*`); each action then checks the
 * caller's grant on that survey ({@see SurveyAccessService}), or for its
 * answers the grant on the survey's data table.
 */
#[AsController]
final class SurveysAdminController
{
    public function __construct(
        private readonly SurveyJsApi $api,
        private readonly SurveyRepository $surveys,
        private readonly SurveyVersionRepository $versions,
        private readonly SurveyResponseStore $responseStore,
        private readonly SurveyService $surveyService,
        private readonly SurveyDashboardService $dashboardService,
        private readonly SurveyPdfService $pdfService,
        private readonly SurveyAccessService $access,
        private readonly SurveyJsRealtimePublisher $realtime,
    ) {
    }

    public function list(): JsonResponse
    {
        $readable = $this->access->readableSurveyIdsOrNull();
        $items = array_values(array_filter(
            $this->surveys->findAllActive(),
            static fn (Survey $survey): bool => $readable === null || in_array((int) $survey->getId(), $readable, true),
        ));
        return $this->api->success(array_map(fn (Survey $survey) => $this->summarize($survey), $items));
    }

    public function create(Request $request): JsonResponse
    {
        $invalid = $this->api->invalid($request, 'requests/admin_survey_create');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $name = (string) ($body['name'] ?? '');
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : [];
        $userId = $this->userId($request);
        if (trim($name) === '') {
            return $this->api->failure('name is required.', 422);
        }
        $survey = $this->surveyService->createSurvey(trim($name), $definition, $userId);
        $this->access->grantCreatorRoles($survey);
        return $this->api->success($this->summarize($survey), 201);
    }

    public function get(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        return $this->api->success($this->detail($survey));
    }

    public function update(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::UPDATE)) {
            return $this->forbidden();
        }
        $invalid = $this->api->invalid($request, 'requests/admin_survey_update');
        if ($invalid !== null) {
            return $invalid;
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
        return $this->api->success($this->summarize($survey));
    }

    public function delete(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::DELETE)) {
            return $this->forbidden();
        }
        $this->access->revokeAll($survey);
        $this->surveyService->delete($survey);
        return $this->api->success(['deleted' => true]);
    }

    public function publishVersion(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::UPDATE)) {
            return $this->forbidden();
        }
        $invalid = $this->api->invalid($request, 'requests/admin_survey_publish');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $userId = $this->userId($request);
        try {
            if (array_key_exists('definition', $body)) {
                if (!is_array($body['definition'])) {
                    return $this->api->failure('definition must be an object.', 422);
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
        } catch (\DomainException $e) {
            // 409: draft conflict or an immutable-key violation (issue #56) -
            // a renamed/removed answered question.name.
            if ($e->getCode() === 409) {
                return $this->api->failure($e->getMessage(), 409, null, null, $this->detail($survey));
            }
            // 422: a question takes a name the system uses as a column.
            if ($e->getCode() === 422) {
                return $this->api->failure($e->getMessage(), 422);
            }
            throw $e;
        }
        return $this->api->success([
            'id' => $survey->getId(),
            'surveyId' => $survey->getSurveyId(),
            'revision' => $version->getRevision(),
            'createdAt' => $version->getCreatedAt()->format(DATE_ATOM),
            'draftHash' => $survey->getDraftDefinitionSha256(),
        ]);
    }

    public function saveDraft(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::UPDATE)) {
            return $this->forbidden();
        }
        $invalid = $this->api->invalid($request, 'requests/admin_survey_draft');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $definition = is_array($body['definition'] ?? null) ? $body['definition'] : null;
        if (!is_array($definition)) {
            return $this->api->failure('definition required.', 422);
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
                return $this->api->failure($e->getMessage(), 409, null, null, $this->detail($survey));
            }
            throw $e;
        }

        return $this->api->success($this->detail($survey));
    }

    public function versions(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        return $this->api->success(array_map(
            fn (SurveyVersion $version) => $this->versionSummary($version),
            $this->versions->findForSurvey($survey),
        ));
    }

    public function restoreVersion(int $id, int $versionId, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        $version = $this->versions->find($versionId);
        if (!$survey instanceof Survey || !$version instanceof SurveyVersion) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::UPDATE)) {
            return $this->forbidden();
        }
        $this->surveyService->restoreVersion($survey, $version, $this->userId($request));
        return $this->api->success($this->detail($survey));
    }

    /**
     * Fetch one published version including its definition. Used by
     * the admin Versions tab to load two revisions side-by-side and
     * compute a structural diff in the browser. Kept out of the list
     * endpoint so the index stays cheap when a survey has dozens of
     * revisions.
     */
    public function getVersion(int $id, int $versionId): JsonResponse
    {
        $survey = $this->surveys->find($id);
        $version = $this->versions->find($versionId);
        if (!$survey instanceof Survey || !$version instanceof SurveyVersion) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        if ($version->getSurvey()->getId() !== $survey->getId()) {
            return $this->api->failure('Version does not belong to this survey.', 400);
        }
        return $this->api->success([
            ...$this->versionSummary($version),
            'definition' => $version->getDefinition(),
        ]);
    }

    public function presence(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->can($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        $invalid = $this->api->invalid($request, 'requests/admin_survey_presence');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $state = (string) ($body['state'] ?? 'editing');
        if (!in_array($state, ['editing', 'idle', 'left'], true)) {
            return $this->api->failure('Invalid state.', 422);
        }
        $userId = $this->userId($request);
        if ($userId === null) {
            return $this->api->failure('Authenticated user required.', 401);
        }
        $this->realtime->surveyEditingPresence($survey, $userId, $this->userName($request, $userId), $state);
        return $this->api->success(['published' => true]);
    }

    public function dashboard(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        return $this->api->success($this->dashboardService->buildSummary($survey));
    }

    /**
     * Flat row payload consumed by the SurveyAnalyticsTabulator-based
     * admin table. The full SurveyJS definition is included so the
     * client-side SurveyAnalytics package can render charts without a
     * second round-trip.
     */
    public function dashboardResults(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        $limit = min(20000, max(1, (int) $request->query->get('limit', 5000)));
        return $this->api->success($this->dashboardService->buildResults($survey, $limit));
    }

    /**
     * Responses of a survey, newest first, unfinished ones included (admin
     * Responses tab; the full list and exports are the core data screen's).
     * Paginated; default page=1, limit=50 (the store reads at most 100).
     */
    public function responses(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }

        $pageNo = max(1, (int) $request->query->get('page', 1));
        $limit = min(100, max(1, (int) $request->query->get('limit', 50)));
        $page = $this->responseStore->list($survey, ($pageNo - 1) * $limit, $limit);

        return $this->api->success([
                'items' => array_map(fn (SurveyResponseRecord $record): array => $this->responseSummary($survey, $record), $page['records']),
                'page' => $pageNo,
                'limit' => $limit,
                'total' => $page['total'],
            ]);
    }

    /**
     * PDF of a single survey response (`SurveyPdfService`: a PDF when dompdf
     * is installed, else a printable page).
     */
    public function responsePdf(int $id, string $rid): Response
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        $record = $this->resolveResponse($survey, $rid);
        if ($record === null) {
            return $this->api->failure('Response not found.', 404);
        }

        return $this->pdfService->renderResponse($survey, $record);
    }

    /**
     * Deletes a single response: the core soft delete of its data row (trigger
     * `deleted`, history kept), the same as deleting it in the data screen.
     */
    public function deleteResponse(int $id, string $rid, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::DELETE)) {
            return $this->forbidden();
        }
        $record = $this->resolveResponse($survey, $rid);
        if ($record === null) {
            return $this->api->failure('Response not found.', 404);
        }
        $responseId = $record->responseId;
        $this->responseStore->delete($survey, $record);
        $userId = is_int($request->attributes->get('_auth_user_id')) ? (int) $request->attributes->get('_auth_user_id') : null;
        $this->realtime->surveyResponseDeleted($survey, $responseId, $userId);
        return $this->api->success(['deleted' => true]);
    }

    public function responseDetail(int $id, string $rid): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->access->canOnResponses($survey, SurveyAccessService::READ)) {
            return $this->forbidden();
        }
        $record = $this->resolveResponse($survey, $rid);
        if ($record === null) {
            return $this->api->failure('Response not found.', 404);
        }

        return $this->api->success([
            ...$this->responseSummary($survey, $record),
            'answers' => $record->answers,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function responseSummary(Survey $survey, SurveyResponseRecord $record): array
    {
        return [
            'id' => $record->recordId,
            'responseId' => $record->responseId,
            'surveyId' => $survey->getSurveyId(),
            'revision' => $record->revision,
            'userId' => $record->userId,
            'userName' => $record->userName,
            'lastSavedAt' => $record->lastChangedAt?->format(DATE_ATOM),
            'finished' => $record->isFinished(),
            'pageNo' => $record->pageNo,
            'language' => $record->language,
        ];
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
            // A count of answers is answers' data: only with the data-table grant.
            'responseCount' => $this->access->canOnResponses($survey, SurveyAccessService::READ)
                ? $this->responseStore->list($survey, 0, 1)['total']
                : null,
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

    private function forbidden(): JsonResponse
    {
        return $this->api->failure('You have no grant on this survey.', 403);
    }

    /** A response of this survey by record id (digits) or response id. */
    private function resolveResponse(Survey $survey, string $rid): ?SurveyResponseRecord
    {
        return ctype_digit($rid)
            ? $this->responseStore->findByRecordId($survey, (int) $rid)
            : $this->responseStore->findByResponseId($survey, $rid);
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

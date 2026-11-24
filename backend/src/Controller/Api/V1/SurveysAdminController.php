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
use Humdek\SurveyJsBundle\Service\SurveyFileAnswers;
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
    /** Someone else saved the draft since the caller loaded it (`data.reason`). */
    public const REASON_DRAFT_CONFLICT = 'draft_conflict';
    /** Publishing would rename or remove a question that has answers. */
    public const REASON_ANSWERED_QUESTION_RENAMED = 'answered_question_renamed';
    /** A question takes a column name the plugin or the core uses. */
    public const REASON_RESERVED_QUESTION_NAME = 'reserved_question_name';

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
        private readonly SurveyFileAnswers $fileAnswers,
    ) {
    }

    public function list(): JsonResponse
    {
        $readable = $this->access->readableSurveyIdsOrNull();
        $items = array_values(array_filter(
            $this->surveys->findAllNewestFirst(),
            static fn (Survey $survey): bool => $readable === null || in_array((int) $survey->getId(), $readable, true),
        ));
        $rights = $this->access->rightsFor($items);

        return $this->api->success([
            'items' => array_map(fn (Survey $survey) => $this->summarize($survey, $rights[(int) $survey->getId()]), $items),
            'canCreate' => $this->access->canCreate(),
        ]);
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
        if ($this->responseStore->hasDataTable($survey) && !$this->access->canOnResponses($survey, SurveyAccessService::DELETE)) {
            return $this->api->failure('Deleting the survey deletes its answers, which needs the delete grant on its data table.', 403);
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
        if (array_key_exists('definition', $body)) {
            if (!is_array($body['definition'])) {
                return $this->api->failure('definition must be an object.', 422);
            }
            try {
                $this->surveyService->saveDraft(
                    $survey,
                    $this->normaliseSurveyDefinition($body['definition']),
                    $this->stringOrNull($body['expectedDraftHash'] ?? null),
                    $userId,
                    (bool) ($body['force'] ?? false),
                );
            } catch (\DomainException $e) {
                if ($e->getCode() === 409) {
                    return $this->api->failure($e->getMessage(), 409, self::REASON_DRAFT_CONFLICT);
                }
                throw $e;
            }
        }
        // The draft is saved by now, also when publishing is refused below:
        // the editor reloads the survey to carry on from that draft.
        try {
            $version = $this->surveyService->publishDraft($survey, $userId);
        } catch (\DomainException $e) {
            // 409: a question with answers renamed or removed (issue #56).
            if ($e->getCode() === 409) {
                return $this->api->failure($e->getMessage(), 409, self::REASON_ANSWERED_QUESTION_RENAMED);
            }
            // 422: a question takes a name the system uses as a column.
            if ($e->getCode() === 422) {
                return $this->api->failure($e->getMessage(), 422, self::REASON_RESERVED_QUESTION_NAME);
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
                return $this->api->failure($e->getMessage(), 409, self::REASON_DRAFT_CONFLICT);
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
        try {
            $this->surveyService->restoreVersion($survey, $version, $this->userId($request));
        } catch (\DomainException $e) {
            return match ($e->getCode()) {
                404 => $this->api->failure('Not found.', 404),
                409 => $this->api->failure($e->getMessage(), 409, self::REASON_ANSWERED_QUESTION_RENAMED),
                422 => $this->api->failure($e->getMessage(), 422, self::REASON_RESERVED_QUESTION_NAME),
                default => throw $e,
            };
        }
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
        // `userId` lets the editor drop its own presence events from the topic.
        return $this->api->success(['published' => true, 'userId' => $userId]);
    }

    public function dashboard(int $id): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->canReadAnswers($survey)) {
            return $this->forbidden();
        }
        return $this->api->success($this->dashboardService->buildSummary($survey));
    }

    /**
     * Finished responses as flat rows for the charts of the Answers tab,
     * with the SurveyJS definition so `survey-analytics` needs no second
     * request.
     */
    public function dashboardResults(int $id, Request $request): JsonResponse
    {
        $survey = $this->surveys->find($id);
        if (!$survey instanceof Survey) {
            return $this->api->failure('Not found.', 404);
        }
        if (!$this->canReadAnswers($survey)) {
            return $this->forbidden();
        }
        $limit = min(20000, max(1, (int) $request->query->get('limit', 5000)));
        return $this->api->success($this->dashboardService->buildResults($survey, $limit));
    }

    /**
     * Whether the caller may see the survey's answers (the Answers tab): the
     * read grant on its data table, or, before the first answer created the
     * table, the read grant on the survey (the list shows 0 answers then).
     */
    private function canReadAnswers(Survey $survey): bool
    {
        return $this->responseStore->hasDataTable($survey)
            ? $this->access->canOnResponses($survey, SurveyAccessService::READ)
            : $this->access->can($survey, SurveyAccessService::READ);
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
     * One response with its answers, to draw it as the survey (admin Answers
     * tab). The list of responses and their deletion are the core data screen's.
     */
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
            'answers' => $this->fileAnswers->answersToClient($record->answers),
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
     * `rights` says which actions the caller may take on the survey, so the
     * screen hides the others; `dataTableId` links its answers in the core
     * data screen and is set only for a caller who may read them.
     *
     * Before the first response there is no data table and nothing to hide:
     * the count is 0. Once it exists, the count needs the read grant on it,
     * and deleting the survey also needs the delete grant on it, as
     * {@see delete()} checks.
     *
     * @param array{update: bool, publish: bool, delete: bool}|null $rights null: computed here
     * @return array<string, mixed>
     */
    private function summarize(Survey $survey, ?array $rights = null): array
    {
        $rights ??= $this->access->rightsFor([$survey])[(int) $survey->getId()];
        $tableId = $this->responseStore->dataTableId($survey);
        $readsAnswers = $tableId === null || $this->access->canOnDataTable($tableId, SurveyAccessService::READ);
        if ($tableId !== null && $rights['delete']) {
            $rights['delete'] = $this->access->canOnDataTable($tableId, SurveyAccessService::DELETE);
        }

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
            'responseCount' => !$readsAnswers ? null : ($tableId === null ? 0 : $this->responseStore->list($survey, 0, 1)['total']),
            'dataTableId' => $readsAnswers ? $tableId : null,
            'rights' => $rights,
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

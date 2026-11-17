<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use App\Exception\ServiceException;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Exception\SurveyFileException;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Humdek\SurveyJsBundle\Service\SurveyResponseDraftService;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use Humdek\SurveyJsBundle\Service\SurveySectionResolver;
use Humdek\SurveyJsBundle\Service\SurveySectionSettings;
use Humdek\SurveyJsBundle\Service\VisitorIdResolver;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Humdek\SurveyJsBundle\Service\SurveyJsApi;

/**
 * Public Surveys API used by the runtime `surveyjs` style.
 *
 * All routes accept the stable generated `survey_id` shown in the
 * admin UI (e.g. `SV_1A2B...`). The internal numeric id stays limited
 * to admin routes.
 *
 * Three families of endpoints:
 *
 * 1. Definition + submission (`/published/{key}` + `/published/{key}/submit`).
 * 2. Progress for autosave / resume (`/published/{key}/progress`) and
 *    editing a submitted response (`/edit`). Progress and the submitted
 *    response are the same row of the survey's data table.
 *
 * The visitor cookie is the guest key: it finds a guest's response again
 * (a guest's row has no owner).
 * 3. File pipeline for the file / GPX / microphone question types
 *    (`/published/{key}/files`, `/files/{fileId}`).
 *
 * Every call names the page and the section it is made for. The core
 * checks the caller may use that section ({@see SurveySectionResolver}),
 * and every setting (limits, window, labels) is read from the published
 * section, never from the request (rule 7.7, F109). Replies are not cached:
 * they depend on the clock and the participant.
 */
#[AsController]
final class SurveysPublicController
{
    public function __construct(
        private readonly ?string $licenseKey,
        private readonly SurveyRepository $surveys,
        private readonly SurveyJsApi $api,
        private readonly SurveyResponseService $responseService,
        private readonly SurveyResponseDraftService $draftService,
        private readonly SurveyFileStorage $fileStorage,
        private readonly SignedFileUrlService $signedUrls,
        private readonly SurveySectionResolver $sections,
        private readonly SurveyAccessService $access,
        private readonly VisitorIdResolver $visitor,
        private readonly SurveyFileRepository $files,
        private readonly SurveyResponseStore $responseStore,
    ) {
    }

    public function published(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            return $this->api->failure('No published version.', 404);
        }

        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }

        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);

        $alreadyLocked = $this->checkLockoutStatus($survey, $userId, $visitorId, $settings);
        $rowKey = $settings->rowKey($this->readUrlParams($request));
        $existingDraft = $this->draftService->resume($survey, $userId, $visitorId, null, $rowKey);
        $completed = $this->responseStore->findLatestFinished($survey, $userId, $visitorId);

        $payload = [
            'data' => [
                'surveyId' => $survey->getSurveyId(),
                'name' => $survey->getName(),
                'themeCode' => $survey->getThemeCode(),
                'revision' => $version->getRevision(),
                'definition' => $this->sections->interpolate($settings, $version->getDefinition()),
                'extraParams' => $settings->urlParams ? $this->readUrlParams($request) : [],
                'runtimeConfig' => [
                    'restartOnRefresh' => $settings->restartOnRefresh,
                    'autoSaveIntervalSeconds' => $settings->autoSaveIntervalSeconds,
                    'timeoutMinutes' => $settings->timeoutMinutes,
                    'savePdf' => $settings->savePdf,
                    'closeModalOnSave' => $settings->closeModalOnSave,
                    'redirectAtEnd' => $settings->redirectAtEnd,
                    'urlParams' => $settings->urlParams,
                    'oncePerUser' => $settings->oncePerUser,
                    'oncePerSchedule' => $settings->oncePerSchedule,
                    'autoSessionKey' => $settings->autoSessionKey,
                    'keyedRows' => $settings->autoSessionKey || $settings->updateBasedOn !== null,
                    'labelSurveyDone' => $settings->labelSurveyDone,
                    'labelSurveyNotActive' => $settings->labelSurveyNotActive,
                ],
                'state' => [
                    'isAuthenticated' => $userId !== null,
                    'notActive' => $settings->isOutsideWindow(),
                    'lockoutReason' => $alreadyLocked,
                    'draft' => $existingDraft !== null ? [
                        'responseId' => $existingDraft->responseId,
                        'pageNo' => $existingDraft->pageNo,
                        'lastSavedAt' => $existingDraft->lastChangedAt?->format(DATE_ATOM),
                    ] : null,
                    'completedResponseId' => $completed?->responseId,
                ],
            ],
        ];
        // The participant's PDF download needs the licence; only a section that
        // offers it gets it.
        if ($settings->savePdf && is_string($this->licenseKey) && $this->licenseKey !== '') {
            $response->headers->set('X-SurveyJs-License-Key', $this->licenseKey);
        }
        $this->api->success($payload['data'], 200, $response);
        $response->setPrivate();
        $response->headers->addCacheControlDirective('no-store');
        return $response;
    }

    public function submit(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $invalid = $this->api->invalid($request, 'requests/public_submit');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $answers = is_array($body['answers'] ?? null) ? $body['answers'] : null;
        if (!is_array($answers)) {
            return $this->api->failure('answers required.', 422);
        }
        // From the client only which response this is and where the
        // participant stands; every limit comes from the section.
        $client = is_array($body['enforce'] ?? null) ? $body['enforce'] : [];
        $editMode = (bool) ($client['editMode'] ?? false);
        $progress = is_array($client['progress'] ?? null) ? $client['progress'] : [];
        if (!$editMode && $settings->isOutsideWindow()) {
            return $this->api->failure('The survey is not open now.', 409, SurveySubmissionRejectedException::REASON_NOT_ACTIVE);
        }
        $window = $settings->oncePerSchedule ? $settings->window() : null;
        $enforce = [
            'oncePerUser' => $settings->oncePerUser,
            'allowAnonymous' => $settings->allowAnonymous,
            'windowStart' => $window !== null ? $window[0]->format(DATE_ATOM) : null,
            'windowEnd' => $window !== null ? $window[1]->format(DATE_ATOM) : null,
            'responseId' => is_string($client['responseId'] ?? null) ? $client['responseId'] : null,
            'editMode' => $editMode,
            'progress' => $progress,
        ];
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $language = is_string($progress['locale'] ?? null) && $progress['locale'] !== '' ? $progress['locale'] : null;

        try {
            $record = $this->responseService->submit($survey, $answers, $userId, $visitorId, $enforce, $language, $settings->rowKey($this->readUrlParams($request)));
        } catch (SurveySubmissionRejectedException $e) {
            $status = match ($e->reason) {
                SurveySubmissionRejectedException::REASON_AUTH_REQUIRED => 401,
                SurveySubmissionRejectedException::REASON_EDIT_FORBIDDEN => 403,
                SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND => 404,
                default => 409,
            };
            return $this->api->failure($e->getMessage(), $status, $e->reason, $response);
        }

        return $this->api->success([
            'recordId' => $record->recordId,
            'responseId' => $record->responseId,
            'submittedAt' => $record->lastChangedAt?->format(DATE_ATOM),
        ], 201, $response);
    }

    public function progressGet(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = $request->query->get('responseId');
        $draft = $this->draftService->resume(
            $survey,
            $userId,
            $visitorId,
            is_string($responseId) ? $responseId : null,
            $settings->rowKey($this->readUrlParams($request)),
        );
        return $this->api->success($draft !== null ? $this->draftPayload($draft) : null, 200, $response);
    }

    public function progressPut(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $invalid = $this->api->invalid($request, 'requests/public_progress');
        if ($invalid !== null) {
            return $invalid;
        }
        $body = $this->decode($request);
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : null;
        if (!is_array($payload)) {
            return $this->api->failure('payload required.', 422);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = is_string($body['responseId'] ?? null) ? $body['responseId'] : null;
        $pageNo = (int) ($body['pageNo'] ?? 0);
        $answers = is_array($payload['data'] ?? null) ? $payload['data'] : [];
        $language = is_string($payload['locale'] ?? null) && $payload['locale'] !== '' ? $payload['locale'] : null;

        try {
            $draft = $this->draftService->save($survey, $responseId, $userId, $visitorId, $answers, $pageNo, $language, $settings->rowKey($this->readUrlParams($request)));
        } catch (\DomainException $e) {
            return $this->api->failure($e->getMessage(), 403, null, $response);
        }
        return $this->api->success($this->draftPayload($draft), 200, $response);
    }

    public function progressDelete(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $userId = $this->userId($request);
        $response = $this->api->success(['deleted' => true]);
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = $request->query->get('responseId');
        $draft = $this->draftService->resume(
            $survey,
            $userId,
            $visitorId,
            is_string($responseId) ? $responseId : null,
            $settings->rowKey($this->readUrlParams($request)),
        );
        if ($draft !== null) {
            $this->draftService->discard($survey, $draft);
        }
        return $response;
    }

    public function editResponse(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = $request->query->get('responseId') ?? $request->query->get('record_id');
        if (!is_string($responseId) || $responseId === '') {
            return $this->api->failure('responseId required.', 422, null, $response);
        }
        $record = $this->responseStore->findByResponseId($survey, $responseId);
        if ($record === null || !$record->isFinished() || !$record->belongsTo($userId, $visitorId)) {
            return $this->api->failure('Not found.', 404, null, $response);
        }
        return $this->api->success([
                'responseId' => $record->responseId,
                'submittedAt' => $record->lastChangedAt?->format(DATE_ATOM),
                'answers' => $record->answers,
            ], 200, $response);
    }

    public function uploadFile(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = (string) $request->request->get('responseId', '');
        $questionName = (string) $request->request->get('questionName', '');
        if ($responseId === '' || $questionName === '') {
            return $this->api->failure('responseId + questionName required.', 422, null, $response);
        }
        $uploaded = $request->files->get('file');
        if ($uploaded === null) {
            return $this->api->failure('file required.', 422, null, $response);
        }

        // The caller must own a response of this survey with that id (saved as
        // progress at least once), so nobody can add files to another
        // participant's response.
        if (!$this->access->canOnResponses($survey, SurveyAccessService::UPDATE)) {
            $record = $this->responseStore->findByResponseId($survey, $responseId);
            if ($record === null) {
                return $this->api->failure('Cannot upload before starting the survey. Save the first page before uploading files.', 403, SurveyFileException::REASON_FORBIDDEN, $response);
            }
            if (!$record->belongsTo($userId, $visitorId)) {
                return $this->api->failure('You do not own this response.', 403, SurveyFileException::REASON_FORBIDDEN, $response);
            }
        }

        try {
            $stored = $this->fileStorage->upload(
                $survey,
                $responseId,
                $questionName,
                $uploaded,
                $userId,
                $visitorId,
            );
        } catch (SurveyFileException $e) {
            $status = match ($e->reason) {
                SurveyFileException::REASON_TOO_LARGE => 413,
                SurveyFileException::REASON_MIME_NOT_ALLOWED => 415,
                default => 422,
            };
            return $this->api->failure($e->getMessage(), $status, $e->reason, $response);
        }

        return $this->api->success($this->filePayload($stored, $userId, $visitorId), 201, $response);
    }

    public function deleteFile(string $key, int $fileId, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return $this->api->failure('Not found.', 404);
        }
        $settings = $this->gate($request, $survey);
        if ($settings instanceof JsonResponse) {
            return $settings;
        }
        $file = $this->files->find($fileId);
        if (!$file instanceof SurveyFile || $file->getSurvey()->getId() !== $survey->getId()) {
            return $this->api->failure('Not found.', 404);
        }
        $userId = $this->userId($request);
        $response = $this->api->success(['deleted' => true]);
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $isAdmin = $this->access->canOnResponses($survey, SurveyAccessService::DELETE);
        if (!$file->isOwnedBy($userId, $visitorId) && !$isAdmin) {
            return $this->api->failure('Forbidden.', 403, null, $response);
        }
        $this->fileStorage->delete($file);
        return $response;
    }

    public function downloadFile(int $fileId, Request $request): Response
    {
        $file = $this->files->find($fileId);
        if (!$file instanceof SurveyFile) {
            return $this->api->failure('Not found.', 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $isAdmin = $this->access->canOnResponses($file->getSurvey(), SurveyAccessService::READ);

        $signature = $request->query->get(SignedFileUrlService::QUERY_SIGNATURE);
        $expires = (int) $request->query->get(SignedFileUrlService::QUERY_EXPIRES);
        $identity = $request->query->get(SignedFileUrlService::QUERY_IDENTITY);
        if (is_string($signature) && is_string($identity) && $expires > 0) {
            try {
                $this->signedUrls->verify($file, $identity, $expires, $signature);
            } catch (SurveyFileException $e) {
                return $this->api->failure($e->getMessage(), 403, $e->reason, $response);
            }
            $decoded = $this->signedUrls->decodeIdentity($identity);
            if (!$isAdmin && !$file->isOwnedBy($decoded['userId'], $decoded['visitorId'])) {
                return $this->api->failure('Forbidden.', 403, null, $response);
            }
        } elseif (!$isAdmin && !$file->isOwnedBy($userId, $visitorId)) {
            return $this->api->failure('Forbidden.', 403, null, $response);
        }

        $absolute = $this->fileStorage->resolvePath($file);
        if (!is_file($absolute)) {
            return $this->api->failure('File missing on disk.', 410, SurveyFileException::REASON_NOT_FOUND, $response);
        }
        $download = new BinaryFileResponse($absolute);
        $download->headers->set('Content-Type', $file->getMimeType());
        $download->setContentDisposition(
            ResponseHeaderBag::DISPOSITION_INLINE,
            $file->getOriginalFilename(),
        );
        return $download;
    }

    /**
     * The page's URL parameters as survey variables `extra_param_<name>`
     * (the names the legacy plugin used), for a section with `url_params`.
     *
     * @return array<string, scalar>
     */
    private function readUrlParams(Request $request): array
    {
        $rawParams = $request->query->all('extraParams');
        $out = [];
        foreach ($rawParams as $key => $value) {
            if (is_string($key) && $key !== '' && is_scalar($value)) {
                $out['extra_param_' . $key] = $value;
            }
        }
        return $out;
    }

    /**
     * Why the participant may not answer again (once per user, or once in
     * today's window in their timezone), or null.
     *
     * @return array{reason: string, responseId: string, submittedAt: string|null}|null
     */
    private function checkLockoutStatus(Survey $survey, ?int $userId, ?string $visitorId, SurveySectionSettings $settings): ?array
    {
        if (!$settings->oncePerUser && !$settings->oncePerSchedule) {
            return null;
        }
        $window = $settings->oncePerSchedule && !$settings->oncePerUser ? $settings->window() : null;
        if ($settings->oncePerSchedule && !$settings->oncePerUser && $window === null) {
            return null;
        }
        $from = $window[0] ?? null;
        $to = $window[1] ?? null;
        $existing = $this->responseStore->findLatestFinished($survey, $userId, $visitorId, $from, $to);
        if ($existing === null && $userId !== null) {
            // A response sent as a guest before signing in counts too.
            $existing = $this->responseStore->findLatestFinished($survey, null, $visitorId, $from, $to);
        }
        if ($existing === null) {
            return null;
        }
        return [
            'reason' => $settings->oncePerUser
                ? SurveySubmissionRejectedException::REASON_ONCE_PER_USER
                : SurveySubmissionRejectedException::REASON_WINDOW_EXHAUSTED,
            'responseId' => $existing->responseId,
            'submittedAt' => $existing->lastChangedAt?->format(DATE_ATOM),
        ];
    }

    /**
     * The section this call is made for, after the core access check, or the
     * error reply. A guest is refused when the section needs a login.
     */
    private function gate(Request $request, Survey $survey): SurveySectionSettings|JsonResponse
    {
        try {
            $settings = $this->sections->resolve($request, $survey);
        } catch (ServiceException $e) {
            $status = $e->getCode() >= 400 && $e->getCode() < 500 ? $e->getCode() : 400;
            return $this->api->failure($e->getMessage(), $status);
        }
        if (!$settings->allowAnonymous && $this->userId($request) === null) {
            return $this->api->failure('This survey needs a login.', 401, SurveySubmissionRejectedException::REASON_AUTH_REQUIRED);
        }

        return $settings;
    }

    /**
     * @return array<string, mixed>
     */
    private function draftPayload(SurveyResponseRecord $draft): array
    {
        return [
            'responseId' => $draft->responseId,
            'pageNo' => $draft->pageNo,
            'payload' => ['data' => $draft->answers, 'locale' => $draft->language],
            'lastSavedAt' => $draft->lastChangedAt?->format(DATE_ATOM),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function filePayload(SurveyFile $file, ?int $userId, ?string $visitorId): array
    {
        $signed = $this->signedUrls->sign($file, $userId, $visitorId);
        $query = http_build_query($signed);
        return [
            'id' => $file->getId(),
            'responseId' => $file->getResponseId(),
            'questionName' => $file->getQuestionName(),
            'filename' => $file->getOriginalFilename(),
            'mimeType' => $file->getMimeType(),
            'sizeBytes' => $file->getSizeBytes(),
            'sha256' => $file->getSha256(),
            'uploadedAt' => $file->getUploadedAt()->format(DATE_ATOM),
            // Browser-side URL: goes through the host Next.js BFF
            // proxy at `/api/[...path]`, which validates CSRF (for
            // unsafe methods), attaches the httpOnly JWT and rewrites
            // the prefix to `/cms-api/v1/...` before hitting Symfony.
            // The HMAC-signed query string is forwarded verbatim.
            'downloadUrl' => '/api/plugins/sh2-shp-survey-js/files/' . $file->getId() . '?' . $query,
        ];
    }

    private function userId(Request $request): ?int
    {
        $payload = $request->attributes->get('_jwt_payload');
        if (is_array($payload) && isset($payload['id_users'])) {
            return (int) $payload['id_users'];
        }
        return null;
    }

    private function resolveSurvey(string $key): ?Survey
    {
        return $this->surveys->findOneBySurveyId($key);
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

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Controller\Api\V1;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyFile;
use Humdek\SurveyJsBundle\Entity\SurveyResponseDraft;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Exception\SurveyFileException;
use Humdek\SurveyJsBundle\Exception\SurveySubmissionRejectedException;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use Humdek\SurveyJsBundle\Service\SurveyDataInterpolator;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Humdek\SurveyJsBundle\Service\SurveyResponseDraftService;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\VisitorIdResolver;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\ResponseHeaderBag;
use Symfony\Component\HttpKernel\Attribute\AsController;

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
 * 2. Draft lifecycle for autosave / restart-on-refresh
 *    (`/published/{key}/progress`, `/edit`).
 * 3. File pipeline for the file / GPX / microphone question types
 *    (`/published/{key}/files`, `/files/{fileId}`).
 *
 * The `published()` response carries the full runtime configuration
 * (theme, timeout, schedule, labels, …) supplied by the section the
 * runtime is on. The runtime sends those fields back inside `enforce`
 * on submit so the server can re-validate the once-per-user /
 * schedule rules independently from the client.
 */
#[AsController]
final class SurveysPublicController
{
    public function __construct(
        private readonly ?string $licenseKey,
        private readonly SurveyRepository $surveys,
        private readonly SurveyResponseService $responseService,
        private readonly SurveyResponseDraftService $draftService,
        private readonly SurveyFileStorage $fileStorage,
        private readonly SignedFileUrlService $signedUrls,
        private readonly SurveyDataInterpolator $interpolator,
        private readonly VisitorIdResolver $visitor,
        private readonly SurveyResponseDraftRepository $drafts,
        private readonly SurveyFileRepository $files,
        private readonly SurveyRunRepository $runs,
        private readonly SurveyAnswerLinkRepository $answerLinks,
    ) {
    }

    public function published(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $version = $survey->getCurrentVersion();
        if ($version === null) {
            return new JsonResponse(['error' => 'No published version.'], 404);
        }

        $config = $this->readRuntimeConfigFromRequest($request);
        $urlParams = $this->readUrlParams($request);
        $interpolation = $this->interpolator->apply(
            $version->getDefinition(),
            is_array($config['dataConfig'] ?? null) ? $config['dataConfig'] : [],
            is_array($config['dynamicReplacement'] ?? null) ? $config['dynamicReplacement'] : [],
            $urlParams,
        );

        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);

        $alreadyLocked = $this->checkLockoutStatus($survey, $userId, $visitorId, $config);
        $existingDraft = $this->draftService->resume($survey, $userId, $visitorId, null);
        $existingRun = $this->runs->findCompletedOwnedRun($survey, $userId, $visitorId);

        $payload = [
            'data' => [
                'surveyId' => $survey->getSurveyId(),
                'name' => $survey->getName(),
                'themeCode' => $survey->getThemeCode(),
                'revision' => $version->getRevision(),
                'definition' => $interpolation['definition'],
                'extraParams' => $interpolation['extraParams'],
                'tokens' => $interpolation['tokens'],
                'runtimeConfig' => [
                    'restartOnRefresh' => (bool) ($config['restartOnRefresh'] ?? false),
                    'autoSaveIntervalSeconds' => (int) ($config['autoSaveIntervalSeconds'] ?? 0),
                    'timeoutMinutes' => (int) ($config['timeoutMinutes'] ?? 0),
                    'savePdf' => (bool) ($config['savePdf'] ?? false),
                    'closeModalAtEnd' => (bool) ($config['closeModalAtEnd'] ?? false),
                    'redirectAtEnd' => $config['redirectAtEnd'] ?? null,
                    'urlParams' => (bool) ($config['urlParams'] ?? false),
                    'startTime' => $config['startTime'] ?? null,
                    'endTime' => $config['endTime'] ?? null,
                    'oncePerUser' => (bool) ($config['oncePerUser'] ?? false),
                    'oncePerSchedule' => (bool) ($config['oncePerSchedule'] ?? false),
                    'ownEntriesOnly' => (bool) ($config['ownEntriesOnly'] ?? false),
                    'allowAnonymous' => (bool) ($config['allowAnonymous'] ?? true),
                    'labelSurveyDone' => $config['labelSurveyDone'] ?? null,
                    'labelSurveyNotActive' => $config['labelSurveyNotActive'] ?? null,
                ],
                'state' => [
                    'isAuthenticated' => $userId !== null,
                    'visitorId' => $visitorId,
                    'lockoutReason' => $alreadyLocked,
                    'draft' => $existingDraft instanceof SurveyResponseDraft ? [
                        'responseId' => $existingDraft->getResponseId(),
                        'pageNo' => $existingDraft->getPageNo(),
                        'lastSavedAt' => $existingDraft->getLastSavedAt()->format(DATE_ATOM),
                    ] : null,
                    'completedResponseId' => $existingRun?->getResponseId(),
                ],
            ],
        ];
        if (($config['savePdf'] ?? false) && is_string($this->licenseKey) && $this->licenseKey !== '') {
            $response->headers->set('X-SurveyJs-License-Key', $this->licenseKey);
        }
        $response->setData($payload);
        return $response;
    }

    public function submit(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        $answers = is_array($body['answers'] ?? null) ? $body['answers'] : null;
        if (!is_array($answers)) {
            return new JsonResponse(['error' => 'answers required.'], 422);
        }
        $enforce = is_array($body['enforce'] ?? null) ? $body['enforce'] : [];
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);

        try {
            $run = $this->responseService->submit($survey, $answers, $userId, $visitorId, $enforce);
        } catch (SurveySubmissionRejectedException $e) {
            $status = match ($e->reason) {
                SurveySubmissionRejectedException::REASON_AUTH_REQUIRED => 401,
                SurveySubmissionRejectedException::REASON_EDIT_FORBIDDEN => 403,
                SurveySubmissionRejectedException::REASON_EDIT_NOT_FOUND => 404,
                default => 409,
            };
            $response->setData([
                'error' => $e->getMessage(),
                'reason' => $e->reason,
            ]);
            $response->setStatusCode($status);
            return $response;
        }

        $response->setData(['data' => [
            'runId' => $run->getId(),
            'responseId' => $run->getResponseId(),
            'submittedAt' => ($run->getCompletedAt() ?? $run->getStartedAt())->format(DATE_ATOM),
        ]]);
        $response->setStatusCode(201);
        return $response;
    }

    public function progressGet(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
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
        );
        $response->setData([
            'data' => $draft instanceof SurveyResponseDraft ? $this->draftPayload($draft) : null,
        ]);
        return $response;
    }

    public function progressPut(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $body = $this->decode($request);
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : null;
        if (!is_array($payload)) {
            return new JsonResponse(['error' => 'payload required.'], 422);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = is_string($body['responseId'] ?? null) ? $body['responseId'] : null;
        $pageNo = (int) ($body['pageNo'] ?? 0);

        $draft = $this->draftService->saveOrCreate(
            $survey,
            $responseId,
            $userId,
            $visitorId,
            $payload,
            $pageNo,
        );
        $response->setData(['data' => $this->draftPayload($draft)]);
        return $response;
    }

    public function progressDelete(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse(['data' => ['deleted' => true]]);
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = $request->query->get('responseId');
        $draft = $this->draftService->resume(
            $survey,
            $userId,
            $visitorId,
            is_string($responseId) ? $responseId : null,
        );
        if ($draft instanceof SurveyResponseDraft) {
            $this->draftService->discard($draft);
        }
        return $response;
    }

    public function editResponse(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = $request->query->get('responseId') ?? $request->query->get('record_id');
        if (!is_string($responseId) || $responseId === '') {
            $response->setData(['error' => 'responseId required.']);
            $response->setStatusCode(422);
            return $response;
        }
        $run = $this->runs->findCompletedOwnedRun($survey, $userId, $visitorId, $responseId);
        if ($run === null) {
            $response->setData(['error' => 'Not found.']);
            $response->setStatusCode(404);
            return $response;
        }
        $answers = [];
        foreach ($this->answerLinks->findForRun($run) as $link) {
            $answers[$link->getQuestionName()] = $this->maybeDecode($link->getAnswerValue());
        }
        $response->setData([
            'data' => [
                'responseId' => $run->getResponseId(),
                'submittedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                'answers' => $answers,
            ],
        ]);
        return $response;
    }

    public function uploadFile(string $key, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $responseId = (string) $request->request->get('responseId', '');
        $questionName = (string) $request->request->get('questionName', '');
        if ($responseId === '' || $questionName === '') {
            $response->setData(['error' => 'responseId + questionName required.']);
            $response->setStatusCode(422);
            return $response;
        }
        $uploaded = $request->files->get('file');
        if ($uploaded === null) {
            $response->setData(['error' => 'file required.']);
            $response->setStatusCode(422);
            return $response;
        }

        $draft = $this->drafts->findOneByResponseId($responseId);
        $run = $this->runs->findOneByResponseId($responseId);
        $isAdmin = $this->hasAdminViewResponses($request);

        // Equivalent safe rule for the seeded
        // `surveyjs.surveys.upload-files` permission: the caller
        // must already own a draft or completed run on this survey
        // identified by `responseId`. This blocks anonymous
        // attackers from injecting files into other participants'
        // drafts/runs while still letting legitimate anonymous
        // participants upload after their first autosave creates a
        // draft.
        if (!$isAdmin) {
            if ($draft === null && $run === null) {
                $response->setData([
                    'error' => 'Cannot upload before starting the survey. Save the first page before uploading files.',
                    'reason' => SurveyFileException::REASON_FORBIDDEN,
                ]);
                $response->setStatusCode(403);
                return $response;
            }
            if ($draft !== null && $draft->getSurvey()->getId() !== $survey->getId()) {
                $response->setData(['error' => 'Draft does not belong to this survey.', 'reason' => SurveyFileException::REASON_FORBIDDEN]);
                $response->setStatusCode(403);
                return $response;
            }
            if ($run !== null && $run->getSurvey()->getId() !== $survey->getId()) {
                $response->setData(['error' => 'Run does not belong to this survey.', 'reason' => SurveyFileException::REASON_FORBIDDEN]);
                $response->setStatusCode(403);
                return $response;
            }
            if ($draft !== null && !$this->draftBelongsTo($draft, $userId, $visitorId)) {
                $response->setData(['error' => 'You do not own this draft.', 'reason' => SurveyFileException::REASON_FORBIDDEN]);
                $response->setStatusCode(403);
                return $response;
            }
            if ($draft === null && $run !== null && !$this->runBelongsTo($run, $userId, $visitorId)) {
                $response->setData(['error' => 'You do not own this response.', 'reason' => SurveyFileException::REASON_FORBIDDEN]);
                $response->setStatusCode(403);
                return $response;
            }
        }

        try {
            $stored = $this->fileStorage->upload(
                $survey,
                $responseId,
                $questionName,
                $uploaded,
                $draft,
                $run,
                $userId,
                $visitorId,
            );
        } catch (SurveyFileException $e) {
            $status = match ($e->reason) {
                SurveyFileException::REASON_TOO_LARGE => 413,
                SurveyFileException::REASON_MIME_NOT_ALLOWED => 415,
                default => 422,
            };
            $response->setData(['error' => $e->getMessage(), 'reason' => $e->reason]);
            $response->setStatusCode($status);
            return $response;
        }

        $response->setData(['data' => $this->filePayload($stored, $userId, $visitorId)]);
        $response->setStatusCode(201);
        return $response;
    }

    public function deleteFile(string $key, int $fileId, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $file = $this->files->find($fileId);
        if (!$file instanceof SurveyFile || $file->getSurvey()->getId() !== $survey->getId()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse(['data' => ['deleted' => true]]);
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $isAdmin = $this->hasAdminViewResponses($request);
        if (!$file->isOwnedBy($userId, $visitorId) && !$isAdmin) {
            $response->setData(['error' => 'Forbidden.']);
            $response->setStatusCode(403);
            return $response;
        }
        $this->fileStorage->delete($file);
        return $response;
    }

    public function downloadFile(int $fileId, Request $request): Response
    {
        $file = $this->files->find($fileId);
        if (!$file instanceof SurveyFile) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $userId = $this->userId($request);
        $response = new JsonResponse();
        $visitorId = $this->visitor->ensureVisitorId($request, $response);
        $isAdmin = $this->hasAdminViewResponses($request);

        $signature = $request->query->get(SignedFileUrlService::QUERY_SIGNATURE);
        $expires = (int) $request->query->get(SignedFileUrlService::QUERY_EXPIRES);
        $identity = $request->query->get(SignedFileUrlService::QUERY_IDENTITY);
        if (is_string($signature) && is_string($identity) && $expires > 0) {
            try {
                $this->signedUrls->verify($file, $identity, $expires, $signature);
            } catch (SurveyFileException $e) {
                $response->setData(['error' => $e->getMessage(), 'reason' => $e->reason]);
                $response->setStatusCode(403);
                return $response;
            }
            $decoded = $this->signedUrls->decodeIdentity($identity);
            if (!$isAdmin && !$file->isOwnedBy($decoded['userId'], $decoded['visitorId'])) {
                $response->setData(['error' => 'Forbidden.']);
                $response->setStatusCode(403);
                return $response;
            }
        } elseif (!$isAdmin && !$file->isOwnedBy($userId, $visitorId)) {
            $response->setData(['error' => 'Forbidden.']);
            $response->setStatusCode(403);
            return $response;
        }

        $absolute = $this->fileStorage->resolvePath($file);
        if (!is_file($absolute)) {
            $response->setData(['error' => 'File missing on disk.', 'reason' => SurveyFileException::REASON_NOT_FOUND]);
            $response->setStatusCode(410);
            return $response;
        }
        $download = new BinaryFileResponse($absolute);
        $download->headers->set('Content-Type', $file->getMimeType());
        $download->setContentDisposition(
            ResponseHeaderBag::DISPOSITION_INLINE,
            $file->getOriginalFilename(),
        );
        return $download;
    }

    public function choices(string $key, string $token, Request $request): Response
    {
        $survey = $this->resolveSurvey($key);
        if (!$survey instanceof Survey || $survey->isArchived()) {
            return new JsonResponse(['error' => 'Not found.'], 404);
        }
        $config = $this->readRuntimeConfigFromRequest($request);
        $dataConfig = is_array($config['dataConfig'] ?? null) ? $config['dataConfig'] : [];
        $catalog = is_array($dataConfig['choices'] ?? null) ? $dataConfig['choices'] : [];
        $values = $catalog[$token] ?? null;
        if (!is_array($values)) {
            return new JsonResponse(['error' => 'Unknown lookup token.'], 404);
        }
        return new JsonResponse(['data' => array_values($values)]);
    }

    /**
     * @return array{
     *     restartOnRefresh?: bool,
     *     autoSaveIntervalSeconds?: int,
     *     timeoutMinutes?: int,
     *     savePdf?: bool,
     *     closeModalAtEnd?: bool,
     *     redirectAtEnd?: ?string,
     *     urlParams?: bool,
     *     startTime?: ?string,
     *     endTime?: ?string,
     *     oncePerUser?: bool,
     *     oncePerSchedule?: bool,
     *     ownEntriesOnly?: bool,
     *     allowAnonymous?: bool,
     *     labelSurveyDone?: ?string,
     *     labelSurveyNotActive?: ?string,
     *     dataConfig?: array<string,mixed>,
     *     dynamicReplacement?: array<string,mixed>,
     * }
     */
    private function readRuntimeConfigFromRequest(Request $request): array
    {
        $body = $this->decode($request);
        if (is_array($body['config'] ?? null)) {
            return $body['config'];
        }
        $configHeader = $request->headers->get('X-SurveyJs-Runtime-Config');
        if (is_string($configHeader) && $configHeader !== '') {
            $decoded = json_decode($configHeader, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        $configQuery = $request->query->get('config');
        if (is_string($configQuery) && $configQuery !== '') {
            $decoded = json_decode($configQuery, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return [];
    }

    /**
     * @return array<string, scalar>
     */
    private function readUrlParams(Request $request): array
    {
        $rawParams = $request->query->all('extraParams');
        $out = [];
        foreach ($rawParams as $key => $value) {
            if (is_string($key) && is_scalar($value)) {
                $out[$key] = $value;
            }
        }
        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function checkLockoutStatus(Survey $survey, ?int $userId, ?string $visitorId, array $config): ?array
    {
        $oncePerUser = (bool) ($config['oncePerUser'] ?? false);
        $oncePerSchedule = (bool) ($config['oncePerSchedule'] ?? false);
        if (!$oncePerUser && !$oncePerSchedule) {
            return null;
        }
        $windowStart = $this->parseRuntimeTimestamp($config['windowStart'] ?? null);
        $windowEnd = $this->parseRuntimeTimestamp($config['windowEnd'] ?? null);
        if ($windowStart === null && $windowEnd === null) {
            [$windowStart, $windowEnd] = $this->resolveScheduleWindow(
                $config['startTime'] ?? null,
                $config['endTime'] ?? null,
            );
        }

        $existing = null;
        if ($userId !== null) {
            $existing = $this->runs->findLatestCompletedForUser(
                $survey,
                $userId,
                $oncePerSchedule ? $windowStart : null,
                $oncePerSchedule ? $windowEnd : null,
            );
        }
        if ($existing === null && $visitorId !== null && $visitorId !== '') {
            $existing = $this->runs->findLatestCompletedForVisitor(
                $survey,
                $visitorId,
                $oncePerSchedule ? $windowStart : null,
                $oncePerSchedule ? $windowEnd : null,
            );
        }
        if ($existing === null) {
            return null;
        }
        return [
            'reason' => $oncePerUser
                ? SurveySubmissionRejectedException::REASON_ONCE_PER_USER
                : SurveySubmissionRejectedException::REASON_WINDOW_EXHAUSTED,
            'responseId' => $existing->getResponseId(),
            'submittedAt' => $existing->getCompletedAt()?->format(DATE_ATOM),
        ];
    }

    /**
     * Resolve the currently-active schedule window using the legacy
     * SurveyJS anchoring logic:
     *
     * - start <= end: same-day window (`12:00 -> 13:00`)
     * - start > end and now < end: start belongs to previous day
     * - start > end and now >= end: end belongs to next day
     *
     * This is what makes "once per schedule" mean "once in the active
     * window until the next window begins", including overnight
     * windows like `22:00 -> 06:00`.
     *
     * @return array{0: ?\DateTimeImmutable, 1: ?\DateTimeImmutable}
     */
    private function resolveScheduleWindow(mixed $startRaw, mixed $endRaw): array
    {
        $start = $this->parseClockTime($startRaw);
        $end = $this->parseClockTime($endRaw);
        if ($start === null || $end === null) {
            return [null, null];
        }

        $tz = new \DateTimeZone('UTC');
        $now = new \DateTimeImmutable('now', $tz);
        $today = $now->setTime(0, 0, 0, 0);

        $windowStart = $today->setTime($start['hour'], $start['minute']);
        $windowEnd = $today->setTime($end['hour'], $end['minute']);

        if ($windowStart > $windowEnd) {
            if ($windowEnd > $now) {
                $windowStart = $windowStart->modify('-1 day');
            } else {
                $windowEnd = $windowEnd->modify('+1 day');
            }
        }

        return [$windowStart, $windowEnd];
    }

    /**
     * @return array{hour:int, minute:int}|null
     */
    private function parseClockTime(mixed $value): ?array
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        if (!preg_match('/^\d{1,2}:\d{2}$/', $value)) {
            return null;
        }
        $parts = explode(':', $value);
        return [
            'hour' => (int) $parts[0],
            'minute' => (int) $parts[1],
        ];
    }

    private function parseRuntimeTimestamp(mixed $value): ?\DateTimeImmutable
    {
        if (!is_string($value) || $value === '') {
            return null;
        }
        try {
            return new \DateTimeImmutable($value);
        } catch (\Exception) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function draftPayload(SurveyResponseDraft $draft): array
    {
        return [
            'responseId' => $draft->getResponseId(),
            'pageNo' => $draft->getPageNo(),
            'payload' => $draft->getPayload(),
            'lastSavedAt' => $draft->getLastSavedAt()->format(DATE_ATOM),
            'expiresAt' => $draft->getExpiresAt()->format(DATE_ATOM),
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

    private function maybeDecode(string $value): mixed
    {
        if ($value === '' || ($value[0] !== '{' && $value[0] !== '[')) {
            return $value;
        }
        $decoded = json_decode($value, true);
        return $decoded ?? $value;
    }

    private function userId(Request $request): ?int
    {
        $payload = $request->attributes->get('_jwt_payload');
        if (is_array($payload) && isset($payload['id_users'])) {
            return (int) $payload['id_users'];
        }
        return null;
    }

    private function hasAdminViewResponses(Request $request): bool
    {
        $payload = $request->attributes->get('_jwt_payload');
        if (!is_array($payload)) {
            return false;
        }
        $perms = $payload['permissions'] ?? null;
        if (is_array($perms) && in_array('surveyjs.surveys.view-responses', $perms, true)) {
            return true;
        }
        $roles = $payload['roles'] ?? null;
        if (is_array($roles) && in_array('admin', $roles, true)) {
            return true;
        }
        return false;
    }

    /**
     * Mirrors {@see \Humdek\SurveyJsBundle\Service\SurveyResponseDraftService::draftBelongsTo()}
     * for the public upload / file routes: a draft "belongs to" the
     * caller when the authenticated user id matches, OR the signed
     * visitor cookie matches, OR the draft started anonymously and
     * the same visitor cookie is presented after login.
     */
    private function draftBelongsTo(SurveyResponseDraft $draft, ?int $userId, ?string $visitorId): bool
    {
        if ($userId !== null && $draft->getIdUser() === $userId) {
            return true;
        }
        if ($visitorId !== null && $visitorId !== '' && $draft->getVisitorId() === $visitorId) {
            return true;
        }
        if ($userId !== null
            && $draft->getIdUser() === null
            && $draft->getVisitorId() !== null
            && $draft->getVisitorId() === $visitorId
        ) {
            return true;
        }
        return false;
    }

    private function runBelongsTo(SurveyRun $run, ?int $userId, ?string $visitorId): bool
    {
        if ($userId !== null && $run->getIdUser() === $userId) {
            return true;
        }
        if ($visitorId !== null && $visitorId !== '' && $run->getVisitorId() === $visitorId) {
            return true;
        }
        return false;
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

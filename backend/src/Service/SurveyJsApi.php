<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Service\Core\ApiResponseFormatter;
use JsonSchema\Constraints\Constraint;
use JsonSchema\Validator;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Replies and request checks of the plugin's API, the SelfHelp way (rule
 * 1.4): every reply is the standard envelope (`status`, `message`, `error`,
 * `logged_in`, `meta`, `data`) built by the core's formatter, and every write
 * request is checked against a JSON Schema the plugin ships under
 * `Resources/schemas/requests/`.
 *
 * The envelope is written into the response object the controller already
 * holds, so headers set on it (the guest cookie, the licence header) stay.
 * A refusal's machine-readable reason travels as `data.reason`.
 */
class SurveyJsApi
{
    private const SCHEMA_DIR = __DIR__ . '/../Resources/schemas/';

    public function __construct(private readonly ApiResponseFormatter $formatter)
    {
    }

    public function success(mixed $data, int $status = Response::HTTP_OK, ?JsonResponse $response = null): JsonResponse
    {
        return $this->into($response, $this->formatter->formatSuccess($data, null, $status, false, true));
    }

    public function failure(string $message, int $status, ?string $reason = null, ?JsonResponse $response = null, mixed $data = null): JsonResponse
    {
        $data ??= $reason !== null ? ['reason' => $reason] : null;

        return $this->into($response, $this->formatter->formatError($message, $status, $data));
    }

    /**
     * The 400 reply for a request body that breaks its schema, or null when it
     * holds. The raw JSON is checked (decoded as objects, so `{}` stays an
     * object); an empty body counts as `{}`. `$schema` is a path under
     * `Resources/schemas/` without `.json`.
     */
    public function invalid(Request $request, string $schema, ?JsonResponse $response = null): ?JsonResponse
    {
        $file = self::SCHEMA_DIR . $schema . '.json';
        $definition = json_decode((string) file_get_contents($file));
        if (!is_object($definition)) {
            throw new \LogicException(sprintf('Request schema "%s" is missing or not JSON.', $schema));
        }
        $content = trim($request->getContent());
        $data = $content === '' ? new \stdClass() : json_decode($content);
        if ($content !== '' && json_last_error() !== JSON_ERROR_NONE) {
            return $this->into($response, $this->formatter->formatError('The request body is not JSON.', Response::HTTP_BAD_REQUEST));
        }
        $validator = new Validator();
        $validator->validate($data, $definition, Constraint::CHECK_MODE_NORMAL);
        if ($validator->isValid()) {
            return null;
        }
        $errors = [];
        foreach ($validator->getErrors() as $error) {
            $property = is_array($error) && is_string($error['property'] ?? null) && $error['property'] !== '' ? $error['property'] : 'request';
            $message = is_array($error) && is_string($error['message'] ?? null) ? $error['message'] : 'is not valid';
            $errors[] = sprintf("Field '%s': %s", $property, $message);
        }

        return $this->into($response, $this->formatter->formatError('Invalid request', Response::HTTP_BAD_REQUEST, null, $errors));
    }

    private function into(?JsonResponse $response, JsonResponse $envelope): JsonResponse
    {
        if ($response === null) {
            return $envelope;
        }
        $response->setContent((string) $envelope->getContent());
        $response->setStatusCode($envelope->getStatusCode());

        return $response;
    }
}

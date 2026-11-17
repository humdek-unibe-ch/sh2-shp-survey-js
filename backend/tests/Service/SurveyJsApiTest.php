<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Service\Core\ApiResponseFormatter;
use Humdek\SurveyJsBundle\Service\SurveyJsApi;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * The plugin's replies are the standard SelfHelp envelope and its write
 * requests are checked against the JSON Schemas it ships (rule 1.4). The
 * core formatter is mocked to a minimal envelope.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyJsApiTest extends TestCase
{
    /** @var list<array{error: string, status: int, data: mixed, validation: list<string>|null}> */
    private array $errors = [];

    public function testARefusalCarriesItsReasonAsData(): void
    {
        $reply = $this->api()->failure('Already answered.', 409, 'already_submitted_once');

        self::assertSame(409, $reply->getStatusCode());
        self::assertSame(['reason' => 'already_submitted_once'], $this->errors[0]['data']);
    }

    public function testTheEnvelopeIsWrittenIntoTheResponseTheControllerHolds(): void
    {
        $response = new JsonResponse();
        $response->headers->set('X-SurveyJs-License-Key', 'kept');

        $reply = $this->api()->success(['responseId' => 'R_1'], 201, $response);

        self::assertSame($response, $reply, 'headers set on it (the guest cookie, the licence) stay');
        self::assertSame(201, $reply->getStatusCode());
        self::assertSame('kept', $reply->headers->get('X-SurveyJs-License-Key'));
        self::assertSame(['responseId' => 'R_1'], json_decode((string) $reply->getContent(), true)['data']);
    }

    public function testAValidSubmitPassesItsSchema(): void
    {
        self::assertNull($this->api()->invalid($this->json(['answers' => (object) [], 'enforce' => ['responseId' => 'R_1', 'editMode' => false, 'progress' => ['pageNo' => 2, 'locale' => 'de', 'meta' => ['ua' => 'x']]]]), 'requests/public_submit'));
    }

    public function testASubmitWithoutAnswersOrWithUnknownFieldsIsRefused(): void
    {
        foreach ([[], ['answers' => 'yes'], ['answers' => (object) [], 'oncePerUser' => false]] as $body) {
            $reply = $this->api()->invalid($this->json($body), 'requests/public_submit');
            self::assertNotNull($reply, (string) json_encode($body));
            self::assertSame(400, $reply->getStatusCode());
        }
        self::assertNotEmpty($this->errors[0]['validation']);
    }

    public function testABodyThatIsNotJsonIsRefused(): void
    {
        $reply = $this->api()->invalid(Request::create('/x', 'POST', [], [], [], [], '{not json'), 'requests/public_progress');

        self::assertSame(400, $reply?->getStatusCode());
        self::assertSame('The request body is not JSON.', $this->errors[0]['error']);
    }

    public function testEveryShippedSchemaIsValidJson(): void
    {
        $files = glob(__DIR__ . '/../../src/Resources/schemas/requests/*.json') ?: [];
        self::assertNotEmpty($files);
        foreach ($files as $file) {
            self::assertIsObject(json_decode((string) file_get_contents($file)), basename($file));
        }
    }

    private function api(): SurveyJsApi
    {
        $formatter = $this->createMock(ApiResponseFormatter::class);
        $formatter->method('formatSuccess')->willReturnCallback(
            static fn (mixed $data = null, ?string $schema = null, int $status = 200): JsonResponse => new JsonResponse(['data' => $data], $status),
        );
        $formatter->method('formatError')->willReturnCallback(
            function (string $error, int $status = 400, mixed $data = null, ?array $validation = null): JsonResponse {
                $this->errors[] = ['error' => $error, 'status' => $status, 'data' => $data, 'validation' => $validation];
                return new JsonResponse(['error' => $error, 'data' => $data], $status);
            },
        );

        return new SurveyJsApi($formatter);
    }

    /**
     * @param array<string, mixed> $body
     */
    private function json(array $body): Request
    {
        return Request::create('/x', 'POST', [], [], [], [], (string) json_encode($body === [] ? (object) [] : $body));
    }
}

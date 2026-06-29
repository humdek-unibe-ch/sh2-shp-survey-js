<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use PHPUnit\Framework\TestCase;

/**
 * Issue #56 regression: the normalizer must emit each answer's human title
 * alongside its immutable `question.name`, so the host can store the title as
 * the mutable `data_cols.display_name` while keeping `name` as the storage
 * key. Covers exact-key resolution, the bare last-segment fallback for
 * dotted panel keys, localized title objects, and the no-title case.
 */
final class SurveyAnswerNormalizerTitleTest extends TestCase
{
    public function testEmitsTitleForTopLevelQuestionAndNullWhenMissing(): void
    {
        $version = $this->version([
            'pages' => [[
                'name' => 'p1',
                'elements' => [
                    ['type' => 'text', 'name' => 'mood_score', 'title' => 'Mood score'],
                    ['type' => 'text', 'name' => 'notes'],
                ],
            ]],
        ]);

        $cells = $this->index($this->normalizer()->normalize($version, [
            'mood_score' => '4',
            'notes' => 'ok',
        ]));

        self::assertSame('Mood score', $cells['mood_score']['title'], 'a titled question carries its label');
        self::assertNull($cells['notes']['title'], 'an untitled question yields a null title (host falls back to field_key)');
        self::assertSame('mood_score', $cells['mood_score']['name'], 'the immutable storage key is the question name');
    }

    public function testResolvesTitleForDottedPanelKeyByLastSegment(): void
    {
        $version = $this->version([
            'pages' => [[
                'name' => 'p1',
                'elements' => [[
                    'type' => 'paneldynamic',
                    'name' => 'household',
                    'templateElements' => [
                        ['type' => 'text', 'name' => 'member_name', 'title' => 'Member name'],
                    ],
                    'elements' => [
                        ['type' => 'text', 'name' => 'member_name', 'title' => 'Member name'],
                    ],
                ]],
            ]],
        ]);

        // A nested answer flattens to the dotted key household.member_name.
        $cells = $this->index($this->normalizer()->normalize($version, [
            'household' => ['member_name' => 'Ada'],
        ]));

        self::assertArrayHasKey('household.member_name', $cells, 'nested answers flatten to a dotted storage key');
        self::assertSame('Member name', $cells['household.member_name']['title'], 'the title resolves via the bare trailing question name');
    }

    public function testResolvesLocalizedTitleObjectPreferringDefault(): void
    {
        $version = $this->version([
            'pages' => [[
                'name' => 'p1',
                'elements' => [
                    ['type' => 'text', 'name' => 'q_loc', 'title' => ['default' => 'Hello', 'de' => 'Hallo']],
                    ['type' => 'text', 'name' => 'q_loc2', 'title' => ['de' => 'Nur Deutsch']],
                ],
            ]],
        ]);

        $cells = $this->index($this->normalizer()->normalize($version, [
            'q_loc' => 'x',
            'q_loc2' => 'y',
        ]));

        self::assertSame('Hello', $cells['q_loc']['title'], 'localized titles prefer the default locale');
        self::assertSame('Nur Deutsch', $cells['q_loc2']['title'], 'localized titles fall back to the first non-empty locale');
    }

    private function normalizer(): SurveyAnswerNormalizer
    {
        return new SurveyAnswerNormalizer(new SurveyJsHtmlSanitizer());
    }

    /**
     * @param array<string, mixed> $definition
     */
    private function version(array $definition): SurveyVersion
    {
        $survey = new Survey('Test', 'SV_NORM');
        return new SurveyVersion($survey, 1, $definition, null);
    }

    /**
     * @param array<int, array{name:string, type:string, title:string|null, value:mixed, sanitizedHtml:bool}> $cells
     * @return array<string, array{name:string, type:string, title:string|null, value:mixed, sanitizedHtml:bool}>
     */
    private function index(array $cells): array
    {
        $out = [];
        foreach ($cells as $cell) {
            $out[$cell['name']] = $cell;
        }
        return $out;
    }
}

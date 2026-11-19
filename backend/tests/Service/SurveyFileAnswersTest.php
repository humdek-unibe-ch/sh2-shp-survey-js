<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use Humdek\SurveyJsBundle\Service\SurveyFileAnswers;
use PHPUnit\Framework\TestCase;

/**
 * File answers name core form files by key: stored without links, sent back
 * with fresh ones, and a participant can never name a file of another response.
 */
final class SurveyFileAnswersTest extends TestCase
{
    private const MINE = 'uploads/form-files/guest/table_3/record_7/field_photo/1_abcdef01_a.png';
    private const OTHER = 'uploads/form-files/user_9/table_3/record_8/field_photo/1_abcdef02_b.png';

    public function testAFileQuestionStoresTheKeyWithoutTheLink(): void
    {
        $sent = [['name' => 'a.png', 'type' => 'image/png', 'content' => json_encode(['key' => self::MINE, 'url' => '/api/x'])]];

        self::assertSame(
            [['name' => 'a.png', 'type' => 'image/png', 'content' => self::MINE]],
            SurveyFileAnswers::toStored($sent, $this->owns(...)),
        );
    }

    public function testAFileOfAnotherResponseIsDropped(): void
    {
        $sent = [
            ['name' => 'a.png', 'type' => 'image/png', 'content' => json_encode(['key' => self::MINE])],
            ['name' => 'b.png', 'type' => 'image/png', 'content' => json_encode(['key' => self::OTHER])],
        ];

        self::assertSame([['name' => 'a.png', 'type' => 'image/png', 'content' => self::MINE]], SurveyFileAnswers::toStored($sent, $this->owns(...)));
        self::assertNull(SurveyFileAnswers::toStored(['key' => self::OTHER, 'durationMs' => 5], $this->owns(...)), 'a recording naming another file goes as a whole');
        self::assertSame(['note' => null], SurveyFileAnswers::toStored(['note' => self::OTHER], $this->owns(...)), 'a stray key is removed');
    }

    public function testARecordingKeepsItsDataAndLosesItsLink(): void
    {
        $sent = ['key' => self::MINE, 'url' => '/api/x', 'filename' => 'r.webm', 'durationMs' => 1200];

        self::assertSame(['key' => self::MINE, 'filename' => 'r.webm', 'durationMs' => 1200], SurveyFileAnswers::toStored($sent, $this->owns(...)));
    }

    public function testAnswersGoBackWithAFreshLink(): void
    {
        $answers = new SurveyFileAnswers(new SignedFileUrlService('secret'));
        $out = $answers->answersToClient([
            'photo' => [['name' => 'a.png', 'type' => 'image/png', 'content' => self::MINE]],
            'track' => ['key' => self::MINE, 'pointCount' => 3],
            'text' => 'hello',
        ]);

        $photo = $out['photo'];
        self::assertIsArray($photo);
        self::assertIsArray($photo[0]);
        $pointer = json_decode((string) $photo[0]['content'], true);
        self::assertIsArray($pointer);
        self::assertSame(self::MINE, $pointer['key']);
        self::assertStringStartsWith('/api/plugins/sh2-shp-survey-js/files?', (string) $pointer['url']);
        self::assertSame('a.png', $pointer['filename']);
        $track = $out['track'];
        self::assertIsArray($track);
        self::assertStringStartsWith('/api/plugins/sh2-shp-survey-js/files?', (string) $track['url']);
        self::assertSame('hello', $out['text']);
    }

    private function owns(string $key): bool
    {
        return $key === self::MINE;
    }
}

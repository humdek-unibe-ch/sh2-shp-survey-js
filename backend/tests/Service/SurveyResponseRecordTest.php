<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use PHPUnit\Framework\TestCase;

/**
 * A row of the survey's data table, as the data query engine returns it,
 * read back into a response: system values and reserved columns apart, the
 * answers keyed by question name with JSON answers decoded.
 */
final class SurveyResponseRecordTest extends TestCase
{
    public function testARowBecomesAResponseWithDecodedAnswers(): void
    {
        $record = SurveyResponseRecord::fromRow([
            'record_id' => 12,
            'entry_date' => '2026-11-17 09:30:00',
            'id_users' => null,
            'user_name' => '',
            'triggerType' => 'updated',
            'response_id' => 'R_ABC',
            'survey_revision' => '2',
            'guest_key' => 'guest-1',
            'language' => 'de',
            'page_no' => '3',
            'q_text' => 'hello',
            'q_matrix' => '{"sleep_well":"yes"}',
            'q_list' => '["a","b"]',
            'q_broken' => '{not json',
            'matrix.sleep_well' => null,
        ]);

        self::assertSame(12, $record->recordId);
        self::assertNull($record->userId);
        self::assertNull($record->userName);
        self::assertSame('R_ABC', $record->responseId);
        self::assertSame(2, $record->revision);
        self::assertSame('guest-1', $record->guestKey);
        self::assertSame('de', $record->language);
        self::assertSame(3, $record->pageNo);
        self::assertFalse($record->isFinished());
        self::assertSame('2026-11-17T09:30:00+00:00', $record->lastChangedAt?->format(DATE_ATOM), 'entry dates are UTC');
        self::assertSame([
            'q_text' => 'hello',
            'q_matrix' => ['sleep_well' => 'yes'],
            'q_list' => ['a', 'b'],
            'q_broken' => '{not json',
        ], $record->answers, 'only answers remain, JSON decoded; a column without a cell in this row is no answer');
    }

    public function testARowWrittenBeforeTheReservedColumnsReadsAsEmpty(): void
    {
        $record = SurveyResponseRecord::fromRow(['record_id' => 3, 'id_users' => 5, 'triggerType' => 'finished', 'q1' => 'x']);

        self::assertTrue($record->isFinished());
        self::assertSame(5, $record->userId);
        self::assertNull($record->revision);
        self::assertNull($record->guestKey);
        self::assertSame(0, $record->pageNo);
        self::assertSame(['q1' => 'x'], $record->answers);
    }

    public function testAResponseBelongsToItsUserOrToTheGuestWithItsKey(): void
    {
        $users = SurveyResponseRecord::fromRow(['record_id' => 1, 'id_users' => 7, 'triggerType' => 'finished']);
        $guests = SurveyResponseRecord::fromRow(['record_id' => 2, 'id_users' => null, 'triggerType' => 'updated', 'guest_key' => 'guest-1']);

        self::assertTrue($users->belongsTo(7, null));
        self::assertFalse($users->belongsTo(8, 'guest-1'));
        self::assertTrue($guests->belongsTo(null, 'guest-1'));
        self::assertTrue($guests->belongsTo(7, 'guest-1'), 'a guest who signed in keeps their response');
        self::assertFalse($guests->belongsTo(null, 'guest-2'));
        self::assertFalse($guests->belongsTo(null, ''));
    }
}

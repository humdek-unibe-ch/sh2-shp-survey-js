<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Service\CMS\Effective\PublicSectionScope;
use Humdek\SurveyJsBundle\Service\SurveySectionSettings;
use PHPUnit\Framework\TestCase;

/**
 * The daily window of a survey section is meant in the participant's
 * timezone (problem 10): the server computes it, never the browser.
 */
final class SurveySectionSettingsTest extends TestCase
{
    public function testTheWindowIsTodayInTheParticipantsTimezone(): void
    {
        $settings = $this->settings('08:00', '12:00', 'Europe/Zurich');
        // 10:30 in Zurich (CET, UTC+1) on a winter day.
        $now = new \DateTimeImmutable('2026-11-17 09:30:00', new \DateTimeZone('UTC'));

        self::assertSame(['2026-11-17T07:00:00+00:00', '2026-11-17T11:00:00+00:00'], $this->iso($settings->window($now)));
        self::assertFalse($settings->isOutsideWindow($now));
        self::assertTrue($settings->isOutsideWindow(new \DateTimeImmutable('2026-11-17 11:30:00', new \DateTimeZone('UTC'))), '12:30 in Zurich is after the window');
    }

    public function testTheSameClockTimesMeanAnotherInstantInAnotherTimezone(): void
    {
        $now = new \DateTimeImmutable('2026-11-17 09:30:00', new \DateTimeZone('UTC'));

        self::assertFalse($this->settings('08:00', '12:00', 'Europe/Zurich')->isOutsideWindow($now));
        self::assertTrue($this->settings('08:00', '12:00', 'America/New_York')->isOutsideWindow($now), 'it is 04:30 in New York');
    }

    public function testAnOvernightWindowStartsTheEveningBeforeEarlyInTheMorning(): void
    {
        $settings = $this->settings('22:00', '06:00', 'UTC');

        $early = new \DateTimeImmutable('2026-11-17 02:00:00', new \DateTimeZone('UTC'));
        self::assertSame(['2026-11-16T22:00:00+00:00', '2026-11-17T06:00:00+00:00'], $this->iso($settings->window($early)));
        self::assertFalse($settings->isOutsideWindow($early));

        $evening = new \DateTimeImmutable('2026-11-17 23:00:00', new \DateTimeZone('UTC'));
        self::assertSame(['2026-11-17T22:00:00+00:00', '2026-11-18T06:00:00+00:00'], $this->iso($settings->window($evening)));

        self::assertTrue($settings->isOutsideWindow(new \DateTimeImmutable('2026-11-17 12:00:00', new \DateTimeZone('UTC'))));
    }

    public function testWithoutAValidWindowTheSurveyIsAlwaysOpen(): void
    {
        foreach ([[null, null], ['08:00', null], ['00:00', '00:00'], ['25:00', '12:00'], ['8h', '12:00']] as [$start, $end]) {
            $settings = $this->settings($start, $end, 'UTC');
            self::assertNull($settings->window());
            self::assertFalse($settings->isOutsideWindow());
        }
    }

    public function testUpdateBasedOnNamesTheRowByTheLinksValue(): void
    {
        $settings = $this->settings(null, null, 'UTC', updateBasedOn: 'extra_param_code');

        self::assertSame(['extra_param_code', 'P-17'], $settings->rowKey(['extra_param_code' => 'P-17']));
        self::assertNull($settings->rowKey([]), 'no key in the link: the survey starts empty');
        self::assertNull($settings->rowKey(['extra_param_code' => '  ']));
    }

    public function testAColumnNamedWithoutThePrefixReadsTheUrlParameterOfThatName(): void
    {
        self::assertSame(['code', 'P-17'], $this->settings(null, null, 'UTC', updateBasedOn: 'code')->rowKey(['extra_param_code' => 'P-17']));
    }

    public function testTheSessionKeyOfASharedLinkNamesTheRow(): void
    {
        $settings = $this->settings(null, null, 'UTC', updateBasedOn: 'extra_param_code', autoSessionKey: true);

        self::assertSame(['extra_param_sid', 'abc'], $settings->rowKey(['extra_param_sid' => 'abc', 'extra_param_code' => 'P-17']), 'the session key wins');
        self::assertNull($this->settings(null, null, 'UTC')->rowKey(['extra_param_sid' => 'abc']), 'off by default');
    }

    /**
     * @param array{0: \DateTimeImmutable, 1: \DateTimeImmutable}|null $window
     * @return list<string>
     */
    private function iso(?array $window): array
    {
        self::assertNotNull($window);
        return [$window[0]->format(DATE_ATOM), $window[1]->format(DATE_ATOM)];
    }

    public function testOncePerUserIsAllTimeEvenWithADailyWindow(): void
    {
        $now = new \DateTimeImmutable('2026-11-17 09:30:00', new \DateTimeZone('UTC'));

        self::assertNotNull($this->settings('08:00', '12:00', 'UTC')->limitWindow($now), 'once per window: only the window of today counts');
        self::assertNull(
            $this->settings('08:00', '12:00', 'UTC', oncePerUser: true)->limitWindow($now),
            'once per user and per window: an answer on any earlier day still counts',
        );
    }

    private function settings(?string $start, ?string $end, string $timezone, ?string $updateBasedOn = null, bool $autoSessionKey = false, bool $oncePerUser = false): SurveySectionSettings
    {
        // The window needs no section content; works with the host class and its stub.
        $scope = (new \ReflectionClass(PublicSectionScope::class))->newInstanceWithoutConstructor();

        return new SurveySectionSettings(
            scope: $scope,
            languageId: 1,
            routeParams: [],
            timezone: new \DateTimeZone($timezone),
            oncePerUser: $oncePerUser,
            oncePerSchedule: true,
            startTime: $start,
            endTime: $end,
            timeoutMinutes: 0,
            allowAnonymous: true,
            restartOnRefresh: false,
            autoSaveIntervalSeconds: 0,
            savePdf: false,
            closeModalOnSave: false,
            redirectAtEnd: null,
            urlParams: false,
            labelSurveyDone: null,
            labelSurveyNotActive: null,
            updateBasedOn: $updateBasedOn,
            autoSessionKey: $autoSessionKey,
        );
    }
}

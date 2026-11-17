<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Service\CMS\Effective\PublicSectionScope;

/**
 * How a survey behaves where it is placed: the settings of one published
 * `surveyjs` section, read on the server (concept section 5). Nothing that
 * limits a participant comes from the request.
 */
final class SurveySectionSettings
{
    /**
     * @param array<string, string> $routeParams the page's route parameters, for variables
     */
    public function __construct(
        public readonly PublicSectionScope $scope,
        public readonly int $languageId,
        public readonly array $routeParams,
        public readonly \DateTimeZone $timezone,
        public readonly bool $oncePerUser,
        public readonly bool $oncePerSchedule,
        public readonly ?string $startTime,
        public readonly ?string $endTime,
        public readonly int $timeoutMinutes,
        public readonly bool $allowAnonymous,
        public readonly bool $restartOnRefresh,
        public readonly int $autoSaveIntervalSeconds,
        public readonly bool $savePdf,
        public readonly bool $closeModalOnSave,
        public readonly ?string $redirectAtEnd,
        public readonly bool $urlParams,
        public readonly ?string $labelSurveyDone,
        public readonly ?string $labelSurveyNotActive,
        public readonly ?string $updateBasedOn = null,
        public readonly bool $autoSessionKey = false,
    ) {
    }

    /** The URL parameter `auto_session_key` puts in the link. */
    public const SESSION_KEY_COLUMN = 'extra_param_sid';

    /**
     * The column and value that name this participant's response row, or
     * null: with `auto_session_key` the `sid` of the link, else the URL value
     * of the `update_based_on` column (`extra_param_<name>`, or `<name>`).
     * Without the value in the URL there is no key: the survey starts empty,
     * so nobody is handed another participant's row (SelfHelp 1 rule).
     *
     * @param array<string, scalar> $urlParams URL parameters as `extra_param_<name>`
     * @return array{0: string, 1: string}|null
     */
    public function rowKey(array $urlParams): ?array
    {
        if ($this->autoSessionKey) {
            $column = self::SESSION_KEY_COLUMN;
        } elseif ($this->updateBasedOn !== null) {
            $column = $this->updateBasedOn;
        } else {
            return null;
        }
        $value = $urlParams[$column] ?? $urlParams['extra_param_' . $column] ?? null;
        $value = is_scalar($value) ? trim((string) $value) : '';

        return $value === '' ? null : [$column, $value];
    }

    /**
     * Today's daily window in the participant's timezone, as UTC instants, or
     * null when the section sets none. An overnight window (`22:00` to
     * `06:00`) starts the evening before when it is now early morning.
     *
     * @return array{0: \DateTimeImmutable, 1: \DateTimeImmutable}|null
     */
    public function window(?\DateTimeImmutable $now = null): ?array
    {
        $start = self::clock($this->startTime);
        $end = self::clock($this->endTime);
        if ($start === null || $end === null || $start === $end) {
            return null;
        }
        $now = ($now ?? new \DateTimeImmutable('now'))->setTimezone($this->timezone);
        $windowStart = $now->setTime($start[0], $start[1]);
        $windowEnd = $now->setTime($end[0], $end[1]);
        if ($windowStart > $windowEnd) {
            if ($now < $windowEnd) {
                $windowStart = $windowStart->modify('-1 day');
            } else {
                $windowEnd = $windowEnd->modify('+1 day');
            }
        }
        $utc = new \DateTimeZone('UTC');

        return [$windowStart->setTimezone($utc), $windowEnd->setTimezone($utc)];
    }

    /** Whether the survey is closed now because of its daily window. */
    public function isOutsideWindow(?\DateTimeImmutable $now = null): bool
    {
        $window = $this->window($now);
        if ($window === null) {
            return false;
        }
        $now ??= new \DateTimeImmutable('now');

        return $now < $window[0] || $now > $window[1];
    }

    /**
     * @return array{0: int, 1: int}|null hour and minute of a `HH:MM` value
     */
    private static function clock(?string $value): ?array
    {
        if ($value === null || preg_match('/^(\d{1,2}):(\d{2})$/', $value, $m) !== 1) {
            return null;
        }
        $hour = (int) $m[1];
        $minute = (int) $m[2];

        return $hour < 24 && $minute < 60 ? [$hour, $minute] : null;
    }
}

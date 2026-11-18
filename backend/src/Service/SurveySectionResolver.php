<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Exception\ServiceException;
use App\Service\CMS\CmsPreferenceService;
use App\Service\CMS\DataColumnService;
use App\Service\CMS\Effective\PublicSectionAccessService;
use App\Service\Core\InterpolationService;
use App\Service\Core\UserContextAwareService;
use Humdek\SurveyJsBundle\Entity\Survey;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Every public survey call names the page and the section it is made for
 * (`page_id`, `section_id`, with `language_id`, `preview`, `route[...]`).
 * This resolver lets the core decide whether the caller may use that section
 * (H4, rule 7.7) and reads the section's settings from the published page, so
 * a participant's limits never come from the request.
 */
class SurveySectionResolver
{
    public const STYLE_NAME = 'surveyjs';
    public const FIELD_SURVEY = 'survey_js';
    /** The field's name before the upgrade, still in pages published before it. */
    public const FIELD_SURVEY_OLD = 'survey-js';

    public function __construct(
        private readonly PublicSectionAccessService $access,
        private readonly InterpolationService $interpolation,
        private readonly UserContextAwareService $userContext,
        private readonly CmsPreferenceService $cmsPreferences,
    ) {
    }

    /**
     * @throws ServiceException 400 page or section missing, or the section shows another survey;
     *                          403/404 from the core access check
     */
    public function resolve(Request $request, Survey $survey): SurveySectionSettings
    {
        $params = self::params($request);
        $pageId = self::positiveInt($params['page_id'] ?? null);
        $sectionId = self::positiveInt($params['section_id'] ?? null);
        if ($pageId === null || $sectionId === null) {
            throw new ServiceException('page_id and section_id are required.', Response::HTTP_BAD_REQUEST);
        }
        $preview = in_array($params['preview'] ?? null, [true, 1, '1', 'true'], true);
        $scope = $this->access->forSection($pageId, $sectionId, self::STYLE_NAME, $preview);

        $surveyKey = trim($scope->field(self::FIELD_SURVEY));
        if ($surveyKey === '') {
            $surveyKey = trim($scope->field(self::FIELD_SURVEY_OLD));
        }
        if ($surveyKey !== $survey->getSurveyId()) {
            throw new ServiceException('The section shows another survey.', Response::HTTP_BAD_REQUEST);
        }

        $languageId = self::positiveInt($params['language_id'] ?? null) ?? 1;
        $text = static fn (string $name): ?string => ($value = trim($scope->field($name))) === '' ? null : $value;
        // A translatable label falls back to the property language (1).
        $label = static fn (string $name): ?string => ($value = trim($scope->field($name, $languageId))) !== ''
            ? $value
            : $text($name);
        $flag = static fn (string $name, bool $default = false): bool => ($value = $text($name)) === null
            ? $default
            : in_array(strtolower($value), ['1', 'true', 'on'], true);
        $number = static fn (string $name): int => is_numeric($value = $text($name)) ? max(0, (int) $value) : 0;

        return new SurveySectionSettings(
            scope: $scope,
            languageId: $languageId,
            routeParams: self::routeParams($params['route'] ?? null),
            timezone: $this->timezone(),
            oncePerUser: $flag('once_per_user'),
            oncePerSchedule: $flag('once_per_schedule'),
            startTime: $text('start_time'),
            endTime: $text('end_time'),
            timeoutMinutes: $number('timeout'),
            allowAnonymous: $flag('allow_anonymous', true),
            restartOnRefresh: $flag('restart_on_refresh'),
            autoSaveIntervalSeconds: $number('auto_save_interval'),
            savePdf: $flag('save_pdf'),
            closeModalOnSave: $flag('close_modal_on_save'),
            redirectAtEnd: $text('redirect_at_end'),
            urlParams: $flag('url_params'),
            labelSurveyDone: $label('label_survey_done'),
            labelSurveyNotActive: $label('label_survey_not_active'),
            updateBasedOn: self::column($text('update_based_on')),
            autoSessionKey: $flag('auto_session_key'),
        );
    }

    /**
     * Replaces `{{variables}}` in the survey's text values with what is valid
     * at the section (H1): user and system values, globals, route parameters,
     * the section's `data_config` data. Never on the JSON as one string, so a
     * value cannot change the survey's structure.
     *
     * @param array<string, mixed> $definition
     * @return array<string, mixed>
     */
    public function interpolate(SurveySectionSettings $settings, array $definition): array
    {
        $variables = $this->access->variables($settings->scope, $settings->languageId, $settings->routeParams);
        $result = [];
        foreach ($this->interpolation->interpolateArray($definition, $variables) as $key => $value) {
            $result[(string) $key] = $value;
        }

        return $result;
    }

    /** The participant's timezone, else the CMS default, else UTC. */
    private function timezone(): \DateTimeZone
    {
        $code = $this->userContext->getCurrentUser()?->getTimezone()?->getLookupCode()
            ?? $this->cmsPreferences->getDefaultTimezone()?->getLookupCode();
        if (is_string($code) && $code !== '') {
            try {
                return new \DateTimeZone($code);
            } catch (\Exception) {
            }
        }

        return new \DateTimeZone('UTC');
    }

    /**
     * Query parameters for a read; the JSON body or the multipart form for a write.
     *
     * @return array<string, mixed>
     */
    private static function params(Request $request): array
    {
        $params = $request->query->all();
        if ($request->request->count() > 0) {
            $params = [...$params, ...$request->request->all()];
        }
        $content = $request->getContent();
        if ($content !== '' && str_starts_with(ltrim($content), '{')) {
            $decoded = json_decode($content, true);
            if (is_array($decoded)) {
                foreach ($decoded as $key => $value) {
                    $params[(string) $key] = $value;
                }
            }
        }

        return $params;
    }

    /**
     * A usable `update_based_on` column name: a data column key, not one the
     * plugin or the core writes itself; anything else is ignored.
     */
    private static function column(?string $name): ?string
    {
        if ($name === null || preg_match('/^[a-z][a-z0-9_]{0,99}$/', $name) !== 1
            || in_array($name, [...SurveyResponseStore::RESERVED_COLUMNS, ...SurveyResponseStore::SYSTEM_COLUMNS], true)
            // The core drops these keys on save, so the row could never be found again.
            || in_array($name, DataColumnService::RESERVED_KEYS, true)) {
            return null;
        }

        return $name;
    }

    private static function positiveInt(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value > 0 ? $value : null;
        }

        return is_string($value) && ctype_digit($value) && (int) $value > 0 ? (int) $value : null;
    }

    /**
     * @return array<string, string>
     */
    private static function routeParams(mixed $value): array
    {
        $out = [];
        if (is_array($value)) {
            foreach ($value as $name => $param) {
                if (is_string($name) && is_scalar($param)) {
                    $out[$name] = (string) $param;
                }
            }
        }

        return $out;
    }
}

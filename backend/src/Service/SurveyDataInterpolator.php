<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

/**
 * `{{var}}` interpolation for SurveyJS definitions.
 *
 * The legacy plugin's `dynamic_replacement` lets a CMS author embed
 * `{{token}}` placeholders inside the SurveyJS JSON and have them
 * substituted at render time from a `data_config` mapping. We keep
 * the same UX but harden it:
 *
 *   - only tokens explicitly declared in `dataConfig.tokens` are
 *     substituted (everything else is left as-is);
 *   - the substitution happens on JSON-encoded text, but the values
 *     are escaped through `json_encode` first so they can never
 *     introduce extra JSON structure (no quote / brace injection);
 *   - URL parameters are exposed under the `extra_param_<key>`
 *     prefix to match the legacy widget names.
 */
final class SurveyDataInterpolator
{
    /**
     * @param array<string, mixed> $definition  SurveyJS definition.
     * @param array<string, mixed> $dataConfig  Style-level `data_config`. Recognised keys: `tokens` (map of name => default value).
     * @param array<string, mixed> $dynamicReplacement  Style-level `dynamic_replacement` (overrides default `tokens`).
     * @param array<string, scalar> $urlParams  URL query string captured by the runtime.
     * @return array{
     *     definition: array<string, mixed>,
     *     extraParams: array<string, scalar>,
     *     tokens: array<string, string>,
     * }
     */
    public function apply(
        array $definition,
        array $dataConfig = [],
        array $dynamicReplacement = [],
        array $urlParams = [],
    ): array {
        $tokens = $this->collectTokens($dataConfig, $dynamicReplacement, $urlParams);
        if ($tokens === [] && $urlParams === []) {
            return [
                'definition' => $definition,
                'extraParams' => $this->extraParams($urlParams),
                'tokens' => [],
            ];
        }

        $json = json_encode($definition, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return [
                'definition' => $definition,
                'extraParams' => $this->extraParams($urlParams),
                'tokens' => $tokens,
            ];
        }

        foreach ($tokens as $name => $value) {
            $encoded = json_encode((string) $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($encoded === false) {
                continue;
            }
            // Strip the outer quotes so `{{token}}` inline in a JSON
            // string still works when the surrounding string already
            // provides them.
            $inline = substr($encoded, 1, -1);
            $json = str_replace('{{' . $name . '}}', $inline, $json);
        }

        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [
                'definition' => $definition,
                'extraParams' => $this->extraParams($urlParams),
                'tokens' => $tokens,
            ];
        }

        return [
            'definition' => $decoded,
            'extraParams' => $this->extraParams($urlParams),
            'tokens' => $tokens,
        ];
    }

    /**
     * @param array<string, mixed> $dataConfig
     * @param array<string, mixed> $dynamicReplacement
     * @param array<string, scalar> $urlParams
     * @return array<string, string>
     */
    private function collectTokens(array $dataConfig, array $dynamicReplacement, array $urlParams): array
    {
        $declared = [];
        $rawTokens = $dataConfig['tokens'] ?? [];
        if (is_array($rawTokens)) {
            foreach ($rawTokens as $name => $default) {
                if (is_string($name) && $name !== '') {
                    $declared[$name] = is_scalar($default) ? (string) $default : '';
                }
            }
        }
        foreach ($dynamicReplacement as $name => $value) {
            if (is_string($name) && $name !== '' && is_scalar($value)) {
                $declared[$name] = (string) $value;
            }
        }
        // URL params override only the explicitly declared tokens so
        // a participant cannot inject arbitrary keys.
        foreach ($urlParams as $key => $value) {
            if (isset($declared[$key]) && is_scalar($value)) {
                $declared[$key] = (string) $value;
            }
        }
        return $declared;
    }

    /**
     * @param array<string, scalar> $urlParams
     * @return array<string, scalar>
     */
    private function extraParams(array $urlParams): array
    {
        $out = [];
        foreach ($urlParams as $key => $value) {
            if (is_string($key) && $key !== '' && is_scalar($value)) {
                $out['extra_param_' . $key] = $value;
            }
        }
        return $out;
    }
}

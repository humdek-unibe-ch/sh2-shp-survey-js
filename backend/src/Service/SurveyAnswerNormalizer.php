<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * Normalizes a SurveyJS submission JSON ({question_name: value, ...})
 * into a flat list of cells the host `UserInput::save_data()` pipeline
 * understands.
 *
 * The normalizer:
 *   - keeps one cell per question (a matrix, multiple-text or dynamic
 *     panel answer stays whole and is stored as JSON);
 *   - applies HTML sanitization for `rich-text` answers via the
 *     injected `SurveyJsHtmlSanitizer`;
     *   - encodes file uploads as a JSON pointer object that downstream
 *     services resolve to the existing files storage;
 *   - returns the per-question normalized cell value, the question
 *     type (so `SurveyResponseService` can persist the right
 *     `survey_answer_link.question_type`) AND the question title (the
 *     human label the host stores as the column `display_name`, while
 *     the immutable `question.name` stays the storage key).
 *
 * The normalizer is NOT responsible for sanitizing or storing the
 * data; it only describes the shape downstream services will use.
 */
final class SurveyAnswerNormalizer
{
    public function __construct(
        private readonly SurveyJsHtmlSanitizer $sanitizer,
    ) {
    }

    /**
     * @param array<string, mixed> $answers
     * @return array<int, array{name:string, type:string, title:string|null, value:mixed, sanitizedHtml:bool}>
     */
    public function normalize(SurveyVersion $version, array $answers): array
    {
        $definition = $version->getDefinition();
        $questionTypes = $this->indexQuestionTypes($definition);
        $questionTitles = $this->indexQuestionTitles($definition);
        $out = [];
        // One cell per question, keyed by the immutable question.name (unique
        // across a survey). A complex answer (matrix, multiple text, dynamic
        // panel) stays whole and is stored as JSON in its cell: splitting it
        // into `question.row` columns gave keys the core refuses (a row value
        // with a space) and changed shape when rows changed.
        foreach ($answers as $name => $value) {
            $name = (string) $name;
            $type = $questionTypes[$name] ?? $this->bareType($questionTypes, $name);
            $title = $questionTitles[$name] ?? null;
            $sanitizedHtml = false;
            if ($type === 'rich-text' && is_string($value)) {
                $value = $this->sanitizer->sanitize($value);
                $sanitizedHtml = true;
            } elseif (is_array($value) && isset($value['__editor']) && $value['__editor'] === 'tiptap' && isset($value['value'])) {
                $value['value'] = is_string($value['value']) ? $this->sanitizer->sanitize($value['value']) : $value['value'];
                $sanitizedHtml = true;
            }
            $out[] = [
                'name' => $name,
                'type' => $type,
                'title' => $title,
                'value' => $value,
                'sanitizedHtml' => $sanitizedHtml,
            ];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $node
     * @return array<string, string>
     */
    private function indexQuestionTypes(array $node, string $prefix = ''): array
    {
        $out = [];
        if (isset($node['pages']) && is_array($node['pages'])) {
            foreach ($node['pages'] as $page) {
                if (is_array($page)) {
                    $pagePrefix = isset($page['name']) ? (string) $page['name'] : '';
                    $out = array_merge($out, $this->indexQuestionTypes($page, $prefix === '' ? $pagePrefix : "$prefix.$pagePrefix"));
                }
            }
        }
        if (isset($node['elements']) && is_array($node['elements'])) {
            foreach ($node['elements'] as $element) {
                if (!is_array($element) || !isset($element['name'])) {
                    continue;
                }
                $name = (string) $element['name'];
                $key = $prefix === '' ? $name : "$prefix.$name";
                if (isset($element['type'])) {
                    $out[$key] = (string) $element['type'];
                }
                $out = array_merge($out, $this->indexQuestionTypes($element, $key));
            }
        }
        return $out;
    }

    /**
     * Collect a flat `question.name => title` map for every titled element in
     * the survey definition. Keyed by the bare element name (NOT the page/panel
     * path) because SurveyJS question names are unique across a whole survey.
     *
     * @param array<string, mixed> $node
     * @return array<string, string>
     */
    private function indexQuestionTitles(array $node): array
    {
        $out = [];
        foreach (['pages', 'elements'] as $childKey) {
            if (!isset($node[$childKey]) || !is_array($node[$childKey])) {
                continue;
            }
            foreach ($node[$childKey] as $child) {
                if (!is_array($child)) {
                    continue;
                }
                if (isset($child['name']) && isset($child['title'])) {
                    $title = $this->resolveTitle($child['title']);
                    if ($title !== null) {
                        $out[(string) $child['name']] = $title;
                    }
                }
                $out = array_merge($out, $this->indexQuestionTitles($child));
            }
        }
        return $out;
    }

    /**
     * SurveyJS titles may be a plain string or a localized object
     * (`{default: "...", de: "..."}`). Prefer `default`, then the first
     * non-empty localized string. Returns null when no usable label exists.
     */
    private function resolveTitle(mixed $title): ?string
    {
        if (is_string($title)) {
            $trimmed = trim($title);
            return $trimmed === '' ? null : $trimmed;
        }
        if (is_array($title)) {
            $default = $title['default'] ?? null;
            if (is_string($default) && trim($default) !== '') {
                return trim($default);
            }
            foreach ($title as $value) {
                if (is_string($value) && trim($value) !== '') {
                    return trim($value);
                }
            }
        }
        return null;
    }

    /**
     * The type of a question whose key in the type index carries its page or
     * panel path (`page1.q1`): question names are unique, so the bare name
     * finds it.
     *
     * @param array<string, string> $questionTypes
     */
    private function bareType(array $questionTypes, string $name): string
    {
        foreach ($questionTypes as $path => $type) {
            if ($path === $name || str_ends_with($path, '.' . $name)) {
                return $type;
            }
        }
        return 'text';
    }
}

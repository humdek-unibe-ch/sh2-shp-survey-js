<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Service\CMS\FormFileUploadService;

/**
 * File answers between the survey and the store. Uploads are core form files
 * (rule 7.3), so a stored answer names each file by its core key and the core
 * delivers, exports and erases it:
 *
 * - file question: `[{name, type, content: <key>}]`
 * - gpx / microphone: `{key, filename, ...the question's own data}`
 *
 * The survey sends and receives the same shapes with a download link added
 * (`content` is then a JSON pointer `{key, url, filename, mimeType}`).
 */
final class SurveyFileAnswers
{
    public function __construct(
        private readonly SignedFileUrlService $links,
    ) {
    }

    /**
     * The answer as stored: links dropped, and every file key the response
     * does not own removed, so a participant can never name someone else's file.
     *
     * @param callable(string): bool $owns
     */
    public static function toStored(mixed $value, callable $owns): mixed
    {
        if (is_string($value)) {
            return self::isKey($value) && !$owns($value) ? null : $value;
        }
        if (!is_array($value)) {
            return $value;
        }
        $isList = array_is_list($value);
        if (!$isList) {
            $pointer = is_string($value['content'] ?? null) ? json_decode($value['content'], true) : null;
            if (is_array($pointer) && is_string($pointer['key'] ?? null)) {
                $value['content'] = $pointer['key'];
            }
            $named = (is_string($value['content'] ?? null) && self::isKey($value['content']))
                || (is_string($value['key'] ?? null) && self::isKey($value['key']));
            if ($named) {
                unset($value['url'], $value['downloadUrl']);
            }
        }
        $out = [];
        foreach ($value as $name => $item) {
            $stored = self::toStored($item, $owns);
            if ($stored === null && $item !== null) {
                if ($isList || in_array($name, ['content', 'key'], true)) {
                    // A file entry whose file is not this response's goes as a whole.
                    if (!$isList) {
                        return null;
                    }
                    continue;
                }
            }
            $out[$name] = $stored;
        }

        return $isList ? array_values($out) : $out;
    }

    /** The stored answer with a fresh download link next to every file key. */
    public function toClient(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            if (is_string($value['content'] ?? null) && self::isKey($value['content'])) {
                $key = $value['content'];
                $value['content'] = json_encode([
                    'key' => $key,
                    'url' => $this->links->url($key),
                    'filename' => is_string($value['name'] ?? null) ? $value['name'] : FormFileUploadService::nameOfKey($key),
                    'mimeType' => is_string($value['type'] ?? null) ? $value['type'] : '',
                ], JSON_UNESCAPED_SLASHES);

                return $value;
            }
            if (is_string($value['key'] ?? null) && self::isKey($value['key'])) {
                $value['url'] = $this->links->url($value['key']);
            }
        }
        foreach ($value as $name => $item) {
            $value[$name] = $this->toClient($item);
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $answers question name => answer
     * @return array<string, mixed>
     */
    public function answersToClient(array $answers): array
    {
        foreach ($answers as $name => $answer) {
            $answers[$name] = $this->toClient($answer);
        }

        return $answers;
    }

    public static function isKey(string $value): bool
    {
        return str_starts_with($value, FormFileUploadService::UPLOAD_DIR);
    }
}

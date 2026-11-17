<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Service\Core\LookupService;

/**
 * One survey response as {@see SurveyResponseStore} reads it from the data
 * store: the row's system values, the reserved columns, and the answers keyed
 * by question name (JSON answers decoded).
 */
final class SurveyResponseRecord
{
    /** Row fields of the data query engine that are not answers. */
    private const SYSTEM_KEYS = ['record_id', 'entry_date', 'id_users', 'user_name', 'user_code', 'triggerType', 'id_action_trigger_types', 'record_version', 'deleted'];

    /**
     * @param array<string, mixed> $answers question name => answer
     */
    public function __construct(
        public readonly int $recordId,
        public readonly ?int $userId,
        public readonly ?string $userName,
        public readonly string $trigger,
        public readonly ?\DateTimeImmutable $lastChangedAt,
        public readonly string $responseId,
        public readonly ?int $revision,
        public readonly ?string $guestKey,
        public readonly ?string $language,
        public readonly int $pageNo,
        public readonly array $answers,
    ) {
    }

    /**
     * @param array<string, mixed> $row a row of {@see \App\Service\CMS\DataQuery\DataQueryResult::$rows}
     */
    public static function fromRow(array $row): self
    {
        $answers = [];
        foreach ($row as $key => $value) {
            // A row lists every column of the table; null means this response
            // has no cell there (a question it never saw, an older column).
            if ($value === null || in_array($key, self::SYSTEM_KEYS, true) || in_array($key, SurveyResponseStore::RESERVED_COLUMNS, true)) {
                continue;
            }
            $answers[$key] = self::decode($value);
        }

        $text = static fn (string $key): string => is_scalar($row[$key] ?? null) ? (string) $row[$key] : '';
        $entryDate = $text('entry_date');

        return new self(
            recordId: (int) $text('record_id'),
            userId: is_numeric($row['id_users'] ?? null) ? (int) $row['id_users'] : null,
            userName: $text('user_name') !== '' ? $text('user_name') : null,
            trigger: $text('triggerType'),
            lastChangedAt: $entryDate !== '' ? new \DateTimeImmutable($entryDate, new \DateTimeZone('UTC')) : null,
            responseId: $text(SurveyResponseStore::COL_RESPONSE_ID),
            revision: is_numeric($row[SurveyResponseStore::COL_REVISION] ?? null) ? (int) $row[SurveyResponseStore::COL_REVISION] : null,
            guestKey: $text(SurveyResponseStore::COL_GUEST_KEY) !== '' ? $text(SurveyResponseStore::COL_GUEST_KEY) : null,
            language: $text(SurveyResponseStore::COL_LANGUAGE) !== '' ? $text(SurveyResponseStore::COL_LANGUAGE) : null,
            pageNo: (int) $text(SurveyResponseStore::COL_PAGE),
            answers: $answers,
        );
    }

    public function isFinished(): bool
    {
        return $this->trigger === LookupService::ACTION_TRIGGER_TYPES_FINISHED;
    }

    /**
     * The meta columns the dashboard table and the exports show before the
     * answers, in that order.
     *
     * @return array<string, scalar|null>
     */
    public function metaColumns(): array
    {
        return [
            'record_id' => $this->recordId,
            'response_id' => $this->responseId,
            'date' => $this->lastChangedAt?->format('Y-m-d H:i:s'),
            'id_users' => $this->userId,
            'user_name' => $this->userName,
            'guest_key' => $this->guestKey,
            'language' => $this->language,
            'page_no' => $this->pageNo,
            'trigger_type' => $this->trigger,
            'revision' => $this->revision,
        ];
    }

    /** Whether the participant (signed-in user or guest key) owns this response. */
    public function belongsTo(?int $userId, ?string $guestKey): bool
    {
        if ($userId !== null && $this->userId === $userId) {
            return true;
        }

        return $guestKey !== null && $guestKey !== '' && $this->guestKey === $guestKey;
    }

    private static function decode(mixed $value): mixed
    {
        if (!is_string($value) || $value === '' || !in_array($value[0], ['[', '{'], true)) {
            return $value;
        }
        try {
            return json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $value;
        }
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Entity\DataTable;
use App\Entity\Plugin\Plugin;
use App\Service\CMS\DataQuery\DataFilter;
use App\Service\CMS\DataQuery\DataFilterGroup;
use App\Service\CMS\DataQuery\DataQuery;
use App\Service\CMS\DataQuery\DataQueryEngine;
use App\Service\CMS\DataQuery\DataSort;
use App\Service\CMS\DataService;
use App\Service\CMS\DataRevision\RecordWriteContext;
use App\Service\Core\LookupService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * The one home of survey responses: one row per response in the core data
 * store, table `sh2_surveyjs_<survey id>` (concept section 4).
 *
 * A response is written through {@see DataService::saveData()} (rule 2.4), so
 * actions, audit, cache, history and user cleanup work with no plugin code.
 * It is read through {@see DataQueryEngine} (rule 2.7). The row's trigger says
 * where it stands: `started` (first progress save), `updated` (later saves),
 * `finished` (submitted). Besides the answers (keyed by the immutable question
 * name) each row carries the reserved columns {@see self::RESERVED_COLUMNS}.
 * A guest's row has no owner; it is found again by its guest key.
 */
class SurveyResponseStore
{
    public const COL_RESPONSE_ID = 'response_id';
    public const COL_REVISION = 'survey_revision';
    public const COL_GUEST_KEY = 'guest_key';
    public const COL_LANGUAGE = 'language';
    public const COL_PAGE = 'page_no';

    /** Columns the plugin writes on every response; a question may not use these names. */
    public const RESERVED_COLUMNS = [
        self::COL_RESPONSE_ID,
        self::COL_REVISION,
        self::COL_GUEST_KEY,
        self::COL_LANGUAGE,
        self::COL_PAGE,
    ];

    /** Keys the core data store reads as row values, not cells. */
    public const SYSTEM_COLUMNS = ['record_id', 'id_users', 'trigger_type', 'entry_date', 'user_name', 'user_code', 'triggerType', 'id_action_trigger_types'];

    private const PLUGIN_ID = 'sh2-shp-survey-js';
    private const DATA_TABLE_PREFIX = 'sh2_surveyjs_';
    private const UNFINISHED_TRIGGERS = [
        LookupService::ACTION_TRIGGER_TYPES_STARTED,
        LookupService::ACTION_TRIGGER_TYPES_UPDATED,
    ];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly DataService $dataService,
        private readonly DataQueryEngine $queries,
        private readonly SurveyAccessService $access,
    ) {
    }

    /**
     * A row keeps the guest key only when a guest wrote it: a signed-in
     * participant is found by user, and a key on their row would let the next
     * person on the same browser match it. A response a guest started keeps
     * its key when they finish it signed in.
     */
    public static function guestKeyToStore(?int $userId, ?string $guestKey, ?SurveyResponseRecord $existing): ?string
    {
        return $userId === null ? $guestKey : $existing?->guestKey;
    }

    public static function tableNameFor(Survey $survey): string
    {
        return self::DATA_TABLE_PREFIX . strtolower($survey->getSurveyId());
    }

    /**
     * Saves progress (`$finished` false) or the submitted response (true).
     * A new response gets trigger `started`, a known one `updated`; a submit
     * always ends as `finished`. Updating names the row by its record id.
     *
     * @param list<array{name: string, type: string, value: mixed, title?: string|null}> $cells normalized answers
     */
    public function save(
        Survey $survey,
        SurveyVersion $version,
        array $cells,
        string $responseId,
        ?string $guestKey,
        ?string $language,
        int $pageNo,
        bool $finished,
        ?SurveyResponseRecord $existing = null,
        ?int $userId = null,
    ): SurveyResponseRecord {
        $tableName = self::tableNameFor($survey);
        $this->ensureDataTable($tableName, $survey);

        // The storage key is the immutable question name; the title travels as
        // the column's display label (core keeps an admin-curated label). A
        // question may not take a reserved or system column (publish refuses
        // such names; this guards older definitions).
        $data = [];
        $labels = [];
        foreach ($cells as $cell) {
            if (in_array($cell['name'], self::RESERVED_COLUMNS, true) || in_array($cell['name'], self::SYSTEM_COLUMNS, true)) {
                continue;
            }
            $data[$cell['name']] = self::stringify($cell['value']);
            $title = $cell['title'] ?? null;
            if (is_string($title) && $title !== '') {
                $labels[$cell['name']] = $title;
            }
        }
        $data += [
            self::COL_RESPONSE_ID => $responseId,
            self::COL_REVISION => (string) $version->getRevision(),
            self::COL_GUEST_KEY => $guestKey ?? '',
            self::COL_LANGUAGE => $language ?? '',
            self::COL_PAGE => (string) max(0, $pageNo),
            'trigger_type' => $finished
                ? LookupService::ACTION_TRIGGER_TYPES_FINISHED
                : ($existing === null ? LookupService::ACTION_TRIGGER_TYPES_STARTED : LookupService::ACTION_TRIGGER_TYPES_UPDATED),
        ];
        // A response a guest started and finishes signed in becomes theirs
        // (core keeps a row's owner on update unless told otherwise).
        if ($existing !== null && $existing->userId === null && $userId !== null) {
            $data['id_users'] = $userId;
        }

        // A trusted plugin write: the owner is the signed-in user, or none for
        // a guest (core never stores a guest as another user).
        $recordId = $this->dataService->saveData(
            $tableName,
            $data,
            LookupService::TRANSACTION_BY_BY_USER,
            $existing !== null ? ['record_id' => $existing->recordId] : null,
            false,
            $labels === [] ? null : $labels,
            new RecordWriteContext(LookupService::DATA_REVISION_SOURCES_FORM),
        );
        if ($recordId === false) {
            throw new \RuntimeException(sprintf('Failed to save the response to survey "%s".', $survey->getSurveyId()));
        }

        return $this->findByRecordId($survey, $recordId)
            ?? throw new \RuntimeException('The saved response could not be read back.');
    }

    public function findByResponseId(Survey $survey, string $responseId): ?SurveyResponseRecord
    {
        return $this->first($survey, [new DataFilter(self::COL_RESPONSE_ID, DataFilter::OP_EQ, $responseId)]);
    }

    public function findByRecordId(Survey $survey, int $recordId): ?SurveyResponseRecord
    {
        return $this->first($survey, [new DataFilter('record_id', DataFilter::OP_EQ, $recordId)]);
    }

    /**
     * The participant's latest unfinished response: by user when signed in,
     * else by guest key.
     */
    public function findUnfinished(Survey $survey, ?int $userId, ?string $guestKey): ?SurveyResponseRecord
    {
        $owner = $this->ownerFilter($userId, $guestKey);
        if ($owner === null) {
            return null;
        }

        return $this->first($survey, [
            $owner,
            new DataFilter('triggerType', DataFilter::OP_IN, self::UNFINISHED_TRIGGERS),
        ]);
    }

    /**
     * The participant's latest finished response, optionally only one last
     * changed inside [$from, $to] (UTC).
     */
    public function findLatestFinished(
        Survey $survey,
        ?int $userId,
        ?string $guestKey,
        ?\DateTimeImmutable $from = null,
        ?\DateTimeImmutable $to = null,
    ): ?SurveyResponseRecord {
        $owner = $this->ownerFilter($userId, $guestKey);
        if ($owner === null) {
            return null;
        }
        $filters = [$owner, new DataFilter('triggerType', DataFilter::OP_EQ, LookupService::ACTION_TRIGGER_TYPES_FINISHED)];
        if ($from !== null) {
            $filters[] = new DataFilter('entry_date', DataFilter::OP_GTE, $from->format('Y-m-d H:i:s'));
        }
        if ($to !== null) {
            $filters[] = new DataFilter('entry_date', DataFilter::OP_LTE, $to->format('Y-m-d H:i:s'));
        }

        return $this->first($survey, $filters);
    }

    /**
     * Responses newest first.
     *
     * @return array{records: list<SurveyResponseRecord>, total: int}
     */
    public function list(Survey $survey, int $offset, int $limit, bool $finishedOnly = false): array
    {
        $table = $this->table($survey);
        if ($table === null) {
            return ['records' => [], 'total' => 0];
        }
        $filters = $finishedOnly
            ? [new DataFilter('triggerType', DataFilter::OP_EQ, LookupService::ACTION_TRIGGER_TYPES_FINISHED)]
            : [];
        $result = $this->queries->run(new DataQuery(
            tableId: (int) $table->getId(),
            filter: new DataFilterGroup(DataFilterGroup::MODE_AND, $filters),
            sorts: [new DataSort('record_id', DataSort::DESC)],
            limit: max(1, min($limit, 100)),
            offset: max(0, $offset),
            withTotal: true,
            optionalColumns: $this->optionalColumns(),
        ));

        return [
            'records' => array_map(fn (array $row): SurveyResponseRecord => SurveyResponseRecord::fromRow($row), $result->rows),
            'total' => $result->total ?? count($result->rows),
        ];
    }

    /**
     * Every finished response, in batches (dashboard and export).
     *
     * @return \Generator<int, SurveyResponseRecord>
     */
    public function eachFinished(Survey $survey): \Generator
    {
        $offset = 0;
        do {
            $page = $this->list($survey, $offset, 100, true);
            foreach ($page['records'] as $record) {
                yield $record;
            }
            $offset += 100;
        } while (count($page['records']) === 100);
    }

    /** Soft-deletes a response (core keeps it and its history; trigger `deleted`). */
    public function delete(Survey $survey, SurveyResponseRecord $record): void
    {
        $table = $this->table($survey);
        if ($table === null) {
            return;
        }
        $this->dataService->deleteData((int) $table->getId(), $record->recordId, false, new RecordWriteContext(LookupService::DATA_REVISION_SOURCES_SYSTEM));
    }

    /**
     * @param list<DataFilter> $filters
     */
    private function first(Survey $survey, array $filters): ?SurveyResponseRecord
    {
        $table = $this->table($survey);
        if ($table === null) {
            return null;
        }
        $result = $this->queries->run(new DataQuery(
            tableId: (int) $table->getId(),
            filter: new DataFilterGroup(DataFilterGroup::MODE_AND, $filters),
            sorts: [new DataSort('record_id', DataSort::DESC)],
            limit: 1,
            optionalColumns: $this->optionalColumns(),
        ));
        $row = $result->rows[0] ?? null;

        return $row === null ? null : SurveyResponseRecord::fromRow($row);
    }

    private function ownerFilter(?int $userId, ?string $guestKey): ?DataFilter
    {
        if ($userId !== null) {
            return new DataFilter('id_users', DataFilter::OP_EQ, $userId);
        }
        if ($guestKey !== null && $guestKey !== '') {
            return new DataFilter(self::COL_GUEST_KEY, DataFilter::OP_EQ, $guestKey);
        }

        return null;
    }

    /**
     * The reserved columns may not exist yet in a table created before them;
     * they read as empty instead of being refused as unknown.
     *
     * @return array<string, string>
     */
    private function optionalColumns(): array
    {
        return array_fill_keys(self::RESERVED_COLUMNS, 'text');
    }

    private function table(Survey $survey): ?DataTable
    {
        return $this->dataService->getDataTableByName(self::tableNameFor($survey));
    }

    private function ensureDataTable(string $tableName, Survey $survey): void
    {
        $plugin = $this->em->getRepository(Plugin::class)->findOneBy(['pluginId' => self::PLUGIN_ID]);
        $existing = $this->em->getRepository(DataTable::class)->findOneBy(['name' => $tableName]);
        if ($existing instanceof DataTable) {
            $changed = false;
            if ($existing->getDisplayName() === null || $existing->getDisplayName() === '') {
                $existing->setDisplayName($survey->getName());
                $changed = true;
            }
            if ($plugin instanceof Plugin && $existing->getPlugin() === null) {
                $existing->setPlugin($plugin);
                $changed = true;
            }
            if ($changed) {
                $this->em->flush();
            }
            return;
        }

        // Created through Doctrine so the host's DataTableAdminAccessListener
        // grants the admin role full rights on the new table.
        $table = new DataTable();
        $table->setName($tableName);
        $table->setDisplayName($survey->getName());
        if ($plugin instanceof Plugin) {
            $table->setPlugin($plugin);
        }
        $this->em->persist($table);
        $this->em->flush();
        $this->access->grantDataTableToSurveyEditors($survey, $table);
    }

    private static function stringify(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        if (is_scalar($value)) {
            return (string) $value;
        }

        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
    }
}

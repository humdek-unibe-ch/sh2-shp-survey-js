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
use App\Exception\ServiceException;
use App\Service\CMS\DataColumnService;
use App\Service\CMS\DataService;
use App\Service\CMS\FormFileUploadService;
use App\Service\CMS\DataRevision\RecordWriteContext;
use App\Service\Core\LookupService;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\File\UploadedFile;
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
    /** Every file uploaded to the response (core form file keys), written on upload so no file is left unnamed. */
    public const COL_UPLOADS = 'uploaded_files';
    /** Uploads one response may hold, so nobody can fill the disk through one survey. */
    public const MAX_UPLOADS = 50;

    /** Columns the plugin writes on every response; a question may not use these names. */
    public const RESERVED_COLUMNS = [
        self::COL_RESPONSE_ID,
        self::COL_REVISION,
        self::COL_GUEST_KEY,
        self::COL_LANGUAGE,
        self::COL_PAGE,
        self::COL_UPLOADS,
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
        private readonly FormFileUploadService $files,
        private readonly DataColumnService $columns,
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
     * @param array{0: string, 1: string}|null $rowKey column and value that name the row (stored as a cell)
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
        ?array $rowKey = null,
    ): SurveyResponseRecord {
        $tableName = self::tableNameFor($survey);
        $this->ensureDataTable($tableName, $survey);
        $table = $this->table($survey);
        // A file answer may only name files uploaded to this response.
        $owns = fn (string $key): bool => $existing !== null && $table !== null
            && $this->files->isRecordFileKey($key, (int) $table->getId(), $existing->recordId);
        $fileColumns = [];

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
            $data[$cell['name']] = self::stringify(SurveyFileAnswers::toStored($cell['value'], $owns));
            if (FormFileUploadService::keysIn($data[$cell['name']]) !== []) {
                $fileColumns[] = $cell['name'];
            }
            $title = $cell['title'] ?? null;
            if (is_string($title) && $title !== '') {
                $labels[$cell['name']] = $title;
            }
        }
        // The row key (`update_based_on`, `auto_session_key`) is a cell of the
        // row, so the next visit with the same link finds it.
        if ($rowKey !== null && !in_array($rowKey[0], [...self::RESERVED_COLUMNS, ...self::SYSTEM_COLUMNS], true)) {
            $data[$rowKey[0]] = $rowKey[1];
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
        if ($fileColumns !== [] && $table !== null) {
            $this->columns->markFileColumns($table, $fileColumns);
        }

        return $this->findByRecordId($survey, $recordId)
            ?? throw new \RuntimeException('The saved response could not be read back.');
    }

    /**
     * Stores an upload as a core form file of the response's row and names it
     * in the row right away ({@see self::COL_UPLOADS}), so even a file the
     * participant never saves in an answer is erased with the response's data.
     * A submitted response is not touched: saving would make it unfinished;
     * its edit names the file when it is submitted again.
     *
     * @return string the file's key
     */
    public function storeUpload(Survey $survey, SurveyResponseRecord $record, UploadedFile $file, string $questionName, ?int $userId): string
    {
        $table = $this->table($survey) ?? throw new \RuntimeException('The survey has no data table yet.');
        if (count($record->uploadedFiles) >= self::MAX_UPLOADS) {
            throw new ServiceException(sprintf('A response may hold at most %d uploaded files.', self::MAX_UPLOADS), 400);
        }
        $key = $this->files->storeRecordFile($file, (int) $table->getId(), $record->recordId, $questionName, $userId);
        $this->columns->markFileColumns($table, [self::COL_UPLOADS]);
        if ($record->isFinished()) {
            return $key;
        }

        $saved = $this->dataService->saveData(
            self::tableNameFor($survey),
            [self::COL_UPLOADS => json_encode([...$record->uploadedFiles, $key], JSON_UNESCAPED_SLASHES) ?: '[]'],
            LookupService::TRANSACTION_BY_BY_USER,
            ['record_id' => $record->recordId],
            false,
            null,
            new RecordWriteContext(LookupService::DATA_REVISION_SOURCES_FORM),
        );
        if ($saved === false) {
            throw new \RuntimeException('The upload could not be named in the response.');
        }

        return $key;
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
     * The unfinished response whose cell `$column` holds `$value` (the row key
     * of `update_based_on` / `auto_session_key`), whoever owns it: knowing the
     * key is what makes the participant its owner. A finished row is never
     * returned, so a completed response is never reopened.
     */
    public function findUnfinishedByCell(Survey $survey, string $column, string $value): ?SurveyResponseRecord
    {
        return $this->first(
            $survey,
            [
                new DataFilter($column, DataFilter::OP_EQ, $value),
                new DataFilter('triggerType', DataFilter::OP_IN, self::UNFINISHED_TRIGGERS),
            ],
            [$column => 'text'],
        );
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
    /**
     * @param array<string, string> $extraColumns columns that may not exist yet, read as empty
     */
    private function first(Survey $survey, array $filters, array $extraColumns = []): ?SurveyResponseRecord
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
            optionalColumns: [...$this->optionalColumns(), ...$extraColumns],
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

    public function hasDataTable(Survey $survey): bool
    {
        return $this->table($survey) !== null;
    }

    /** Id of the survey's data table, null before the first response. */
    public function dataTableId(Survey $survey): ?int
    {
        $id = $this->table($survey)?->getId();

        return $id === null ? null : (int) $id;
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

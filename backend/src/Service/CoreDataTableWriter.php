<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Entity\DataTable;
use App\Entity\Plugin\Plugin;
use App\Service\CMS\DataService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * Adapts SurveyJS submissions to the host form-data save pipeline.
 *
 * Creates/updates the matching `data_tables` row through Doctrine so the
 * host's `DataTableAdminAccessListener` fires and the admin role gets
 * full CRUD on freshly-created survey data tables automatically.
 */
final class CoreDataTableWriter implements DataTableWriterInterface
{
    private const PLUGIN_ID = 'sh2-shp-survey-js';
    private const DATA_TABLE_PREFIX = 'sh2_surveyjs_';
    private const TRANSACTION_BY_USER = 'by_user';
    private const TRANSACTION_BY_ANONYMOUS_USER = 'by_anonymous_user';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly DataService $dataService,
    ) {
    }

    public function writeRow(
        Survey $survey,
        SurveyVersion $version,
        array $cells,
        ?int $userId,
        string $responseId,
        ?int $existingDataRowId = null,
    ): DataTableWriteResult {
        $tableName = $this->getDataTableName($survey);
        $this->ensureDataTableExists($tableName, $survey);

        // The response_id cell makes every CMS Data Management row
        // self-describing: it carries the same `R_...` id stored on the
        // matching `survey_runs.response_id`, so an operator browsing
        // `sh2_surveyjs_<surveyId>` can trace any row straight back to
        // the SurveyJS dashboard without joining plugin-owned tables.
        // `DataService` will create the `data_cols` entry on first use.
        $data = [
            'id_users'    => $userId ?? 1,
            'response_id' => $responseId,
        ];
        // Storage key is the immutable question.name; the question title (when
        // present) travels as the column display label. The host stores the key
        // and only auto-refreshes the label while it was not admin-curated.
        $labels = [];
        foreach ($cells as $cell) {
            $data[$cell['name']] = $this->stringifyCellValue($cell['value']);
            $title = $cell['title'] ?? null;
            if (is_string($title) && $title !== '') {
                $labels[$cell['name']] = $title;
            }
        }

        $dataRowId = $this->dataService->saveData(
            $tableName,
            $data,
            $userId === null ? self::TRANSACTION_BY_ANONYMOUS_USER : self::TRANSACTION_BY_USER,
            // In edit mode we re-use the existing data_rows row by
            // passing the matching constraint to DataService, which
            // resolves it to an UPDATE instead of an INSERT. Outside
            // edit mode we leave it null so a brand-new row is
            // inserted.
            $existingDataRowId !== null ? ['id' => $existingDataRowId] : null,
            false,
            $labels === [] ? null : $labels,
        );

        if ($dataRowId === false) {
            throw new \RuntimeException(sprintf('Failed to save SurveyJS response for survey "%s".', $survey->getSurveyId()));
        }

        return new DataTableWriteResult($dataRowId);
    }

    private function getDataTableName(Survey $survey): string
    {
        return self::DATA_TABLE_PREFIX . strtolower($survey->getSurveyId());
    }

    private function ensureDataTableExists(string $tableName, Survey $survey): void
    {
        $pluginEntity = $this->getPluginEntity();
        $repository = $this->em->getRepository(DataTable::class);
        $existing = $repository->findOneBy(['name' => $tableName]);

        if ($existing instanceof DataTable) {
            $changed = false;
            if ($existing->getDisplayName() === null || $existing->getDisplayName() === '') {
                $existing->setDisplayName($survey->getName());
                $changed = true;
            }
            if ($pluginEntity instanceof Plugin && $existing->getPlugin() === null) {
                $existing->setPlugin($pluginEntity);
                $changed = true;
            }
            if ($changed) {
                $this->em->flush();
            }
            return;
        }

        $dataTable = new DataTable();
        $dataTable->setName($tableName);
        $dataTable->setDisplayName($survey->getName());
        if ($pluginEntity instanceof Plugin) {
            $dataTable->setPlugin($pluginEntity);
        }

        $this->em->persist($dataTable);
        $this->em->flush();
    }

    private function getPluginEntity(): ?Plugin
    {
        return $this->em->getRepository(Plugin::class)->findOneBy(['pluginId' => self::PLUGIN_ID]);
    }

    private function stringifyCellValue(mixed $value): string
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

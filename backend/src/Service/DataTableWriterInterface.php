<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;

/**
 * Contract the host wires up to insert SurveyJS submissions into the
 * core `data_tables` / `data_rows` / `data_cells` storage. Keeping
 * this as an interface lets the plugin remain decoupled from internal
 * CMS form services and lets a host swap the implementation (e.g. for
 * tests).
 */
interface DataTableWriterInterface
{
    /**
     * @param list<array{name:string, type:string, title?:string|null, value:mixed, sanitizedHtml:bool}> $cells
     *                                    each cell's immutable `name` is the storage key (host
     *                                    `data_cols.field_key`); the optional `title` is the human
     *                                    label the host stores as the column `display_name`.
     * @param string   $responseId        the SurveyJS `R_...` response id that is also persisted on
     *                                    `survey_runs.response_id`; the writer stores it inside the
     *                                    target `data_tables` row (`response_id` cell) so the CMS
     *                                    Data Management browser can trace any row back to a survey
     *                                    response without joining the plugin-owned tables.
     * @param ?int     $existingDataRowId when non-null, the writer updates that exact `data_rows`
     *                                    row in place (used by edit-mode submit so a re-submission
     *                                    does not duplicate rows in `data_tables`). When null,
     *                                    the writer inserts a fresh row.
     */
    public function writeRow(
        Survey $survey,
        SurveyVersion $version,
        array $cells,
        ?int $userId,
        string $responseId,
        ?int $existingDataRowId = null,
    ): DataTableWriteResult;
}

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
     * @param list<array{name:string, type:string, value:mixed, sanitizedHtml:bool}> $cells
     */
    public function writeRow(Survey $survey, SurveyVersion $version, array $cells, ?int $userId): DataTableWriteResult;
}

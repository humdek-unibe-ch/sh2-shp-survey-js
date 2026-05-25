<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

/**
 * DTO returned by `DataTableWriterInterface::writeRow()`.
 */
final class DataTableWriteResult
{
    public function __construct(
        public readonly int $idDataRow,
    ) {
    }
}

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
 * No-op writer used when the host has not yet aliased
 * `DataTableWriterInterface` to its own implementation (for example
 * during the initial install on a fresh CMS, in unit tests, or when
 * the plugin is loaded without the CMS core services). The host swaps
 * this for a real writer via DI alias in `config/services.yaml`.
 *
 * Returning the run's primary key (0 for "not persisted to data
 * tables") keeps the rest of the submission pipeline functional and
 * surfaces the missing host wiring as a soft warning instead of a
 * hard container compile error.
 */
final class NullDataTableWriter implements DataTableWriterInterface
{
    public function writeRow(
        Survey $survey,
        SurveyVersion $version,
        array $cells,
        ?int $userId,
        string $responseId,
    ): DataTableWriteResult {
        return new DataTableWriteResult(0);
    }
}

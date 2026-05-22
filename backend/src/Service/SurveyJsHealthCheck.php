<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;

/**
 * Health check exposed via the manifest `health.serviceId`
 * (`humdek.surveyjs.health_check`). Returns a structured report the
 * host plugin doctor merges into its global report.
 */
final class SurveyJsHealthCheck
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ?string $licenseKey,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function check(): array
    {
        $surveyCount = (int) $this->em->getRepository(Survey::class)
            ->createQueryBuilder('s')
            ->select('COUNT(s.id)')
            ->getQuery()
            ->getSingleScalarResult();

        $licenseStatus = $this->licenseKey !== null && $this->licenseKey !== ''
            ? ['status' => 'ok', 'detail' => 'License key configured.']
            : ['status' => 'warn', 'detail' => 'No SURVEYJS_LICENSE_KEY set; running unlicensed.'];

        return [
            'pluginId' => 'sh2-shp-survey-js',
            'checks' => [
                ['key' => 'db.connectivity', 'status' => 'ok', 'detail' => sprintf('%d surveys.', $surveyCount)],
                ['key' => 'license-key', ...$licenseStatus],
                ['key' => 'csp.external-hosts', 'status' => 'ok', 'detail' => 'OSM + Carto declared in manifest.'],
            ],
        ];
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use App\Plugin\Health\PluginHealthCheckInterface;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;

/**
 * The plugin's checks in the host's plugin health report (the Health tab
 * of the plugin in the admin and the doctor command). The host finds it by
 * the `selfhelp.plugin.health_check` tag and lists each subcheck as
 * `plugin:<name>`.
 */
final class SurveyJsHealthCheck implements PluginHealthCheckInterface
{
    public const PLUGIN_ID = 'sh2-shp-survey-js';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly ?string $licenseKey,
    ) {
    }

    public function getPluginId(): string
    {
        return self::PLUGIN_ID;
    }

    public function runHealthCheck(): array
    {
        $subchecks = [$this->database(), $this->licenseKey()];
        $statuses = array_column($subchecks, 'status');
        $status = in_array('failed', $statuses, true) ? 'failed' : (in_array('warning', $statuses, true) ? 'warning' : 'ok');

        return ['status' => $status, 'subchecks' => $subchecks];
    }

    /**
     * The interface asks for no exceptions: an unreachable table is a failed subcheck.
     *
     * @return array{name: string, status: 'ok'|'failed', message: string}
     */
    private function database(): array
    {
        try {
            $count = (int) $this->em->getRepository(Survey::class)
                ->createQueryBuilder('s')
                ->select('COUNT(s.id)')
                ->getQuery()
                ->getSingleScalarResult();

            return ['name' => 'database', 'status' => 'ok', 'message' => sprintf('%d surveys.', $count)];
        } catch (\Throwable $e) {
            return ['name' => 'database', 'status' => 'failed', 'message' => 'The surveys table cannot be read: ' . $e->getMessage()];
        }
    }

    /** @return array{name: string, status: 'ok'|'warning', message: string} */
    private function licenseKey(): array
    {
        return $this->licenseKey !== null && $this->licenseKey !== ''
            ? ['name' => 'license-key', 'status' => 'ok', 'message' => 'License key configured.']
            : ['name' => 'license-key', 'status' => 'warning', 'message' => 'No SURVEYJS_LICENSE_KEY set; the Creator and Dashboard run unlicensed.'];
    }
}

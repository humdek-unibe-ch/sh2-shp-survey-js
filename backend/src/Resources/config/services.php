<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysAdminController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysHealthController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysLicenseController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysPublicController;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsApiRouteSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsLookupRegistrySubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsRealtimeTopicSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsStyleRegistrySubscriber;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\CoreDataTableWriter;
use Humdek\SurveyJsBundle\Service\DataTableWriterInterface;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyJsGdprService;
use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyPdfService;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyService;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $configurator): void {
    $services = $configurator->services()
        ->defaults()
            ->autowire()
            ->autoconfigure();

    $services->load('Humdek\\SurveyJsBundle\\', '../../*')
        ->exclude([
            '../../{Entity,Migrations,Resources,Tests}',
            '../../HumdekSurveyJsBundle.php',
            '../../Service/DataTableWriterInterface.php',
            '../../Service/DataTableWriteResult.php',
        ]);

    $services->set(SurveyRepository::class)->autowire();
    $services->set(SurveyVersionRepository::class)->autowire();
    $services->set(SurveyRunRepository::class)->autowire();
    $services->set(SurveyAnswerLinkRepository::class)->autowire();

    $services->set(SurveyJsHtmlSanitizer::class)->autowire();
    $services->set(SurveyAnswerNormalizer::class)->autowire();
    $services->set(SurveyService::class)->autowire();
    $services->set(SurveyResponseService::class)->autowire();
    $services->set(SurveyDashboardService::class)->autowire();
    $services->set(SurveyJsGdprService::class)->autowire();
    $services->set(SurveyPdfService::class)->autowire();

    // SurveyJS answers should land in the host's legacy form-data
    // tables immediately, matching the old plugin's data flow.
    $services->set(CoreDataTableWriter::class)->autowire();
    $services->set(DataTableWriterInterface::class, CoreDataTableWriter::class);

    // SurveyJsRealtimePublisher is autowired against the host
    // `App\Plugin\Realtime\PluginRealtimePublisherInterface` which the
    // CMS aliases to its concrete `PluginRealtimePublisher` in
    // `config/services.yaml`. No plugin-local fallback exists; the
    // bundle requires the host realtime layer to be present.
    $services->set(SurveyJsRealtimePublisher::class)->autowire();

    $services->set(SurveyJsHealthCheck::class)
        ->arg('$licenseKey', '%env(default::SURVEYJS_LICENSE_KEY)%');

    $services->set(SurveysLicenseController::class)
        ->arg('$licenseKey', '%env(default::SURVEYJS_LICENSE_KEY)%')
        ->tag('controller.service_arguments');

    $services->set(SurveysAdminController::class)->tag('controller.service_arguments');
    $services->set(SurveysPublicController::class)->tag('controller.service_arguments');
    $services->set(SurveysHealthController::class)->tag('controller.service_arguments');

    $services->set(SurveyJsStyleRegistrySubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsLookupRegistrySubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsRealtimeTopicSubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsApiRouteSubscriber::class)->tag('kernel.event_subscriber');
};

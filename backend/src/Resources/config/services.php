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
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsLookupRegistrySubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsRealtimeTopicSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsStyleRegistrySubscriber;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\NullPluginRealtimePublisher;
use Humdek\SurveyJsBundle\Service\PluginRealtimePublisherInterface;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyJsGdprService;
use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
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
            '../../{Entity,Migrations,Tests}',
            '../../HumdekSurveyJsBundle.php',
            '../../Service/DataTableWriterInterface.php',
            '../../Service/DataTableWriteResult.php',
            '../../Service/PluginRealtimePublisherInterface.php',
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

    // Default null publisher. The host's `PluginRealtimePublisher`
    // (`App\Plugin\Realtime\PluginRealtimePublisherInterface`) is
    // aliased into our local interface in the application's
    // services.yaml when the plugin runs inside the CMS. When the
    // bundle is loaded in isolation (tests / fresh installs without
    // Mercure) we fall back to the no-op.
    $services->set(PluginRealtimePublisherInterface::class, NullPluginRealtimePublisher::class);

    $services->set(SurveyJsRealtimePublisher::class)
        ->arg('$host', service(PluginRealtimePublisherInterface::class));

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
};

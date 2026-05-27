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
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyResponseDraftRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\CoreDataTableWriter;
use Humdek\SurveyJsBundle\Service\DataTableWriterInterface;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyDataInterpolator;
use Humdek\SurveyJsBundle\Service\SurveyExportService;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Humdek\SurveyJsBundle\Service\SurveyJsGdprService;
use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyPdfService;
use Humdek\SurveyJsBundle\Service\SurveyResponseDraftService;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyService;
use Humdek\SurveyJsBundle\Service\VisitorIdResolver;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $configurator): void {
    $services = $configurator->services()
        ->defaults()
            ->autowire()
            ->autoconfigure();

    $services->load('Humdek\\SurveyJsBundle\\', '../../*')
        ->exclude([
            '../../{Entity,Exception,Migrations,Resources,Tests}',
            '../../HumdekSurveyJsBundle.php',
            '../../Service/DataTableWriterInterface.php',
            '../../Service/DataTableWriteResult.php',
        ]);

    $services->set(SurveyRepository::class)->autowire();
    $services->set(SurveyVersionRepository::class)->autowire();
    $services->set(SurveyRunRepository::class)->autowire();
    $services->set(SurveyAnswerLinkRepository::class)->autowire();
    $services->set(SurveyResponseDraftRepository::class)->autowire();
    $services->set(SurveyFileRepository::class)->autowire();

    $services->set(SurveyJsHtmlSanitizer::class)->autowire();
    $services->set(SurveyAnswerNormalizer::class)->autowire();
    $services->set(SurveyService::class)->autowire();
    $services->set(SurveyResponseService::class)->autowire();
    $services->set(SurveyResponseDraftService::class)->autowire();
    $services->set(SurveyDashboardService::class)->autowire();
    $services->set(SurveyExportService::class)->autowire();
    $services->set(SurveyDataInterpolator::class)->autowire();
    $services->set(SurveyJsGdprService::class)->autowire();
    $services->set(SurveyPdfService::class)->autowire();

    // Anonymous-user identity for once-per-user enforcement.
    // `kernel.secret` is the host parameter that mirrors `APP_SECRET`;
    // referencing `APP_SECRET` directly as a parameter would fail because
    // env names are not parameters.
    $services->set(VisitorIdResolver::class)
        ->arg('$secret', '%env(default:kernel.secret:SURVEYJS_VISITOR_SECRET)%');

    // Defaults for the env-driven knobs below. Symfony's `default:`
    // env processor requires the fallback to be a **parameter name**,
    // not a literal — so we materialise the literals here. Operators
    // still override via env (`SURVEYJS_UPLOAD_MAX_BYTES`, etc.).
    $configurator->parameters()
        ->set('surveyjs_default_upload_dir', '%kernel.project_dir%/var/plugin-data/sh2-shp-survey-js/uploads')
        ->set('surveyjs_default_upload_max_bytes', 25000000)
        ->set('surveyjs_default_file_url_ttl_seconds', 300);

    // Private file storage (outside web root). Defaults resolve to
    // `<project>/var/plugin-data/sh2-shp-survey-js/uploads` when the
    // env override is missing.
    $services->set(SurveyFileStorage::class)
        ->arg('$uploadDir', '%env(default:surveyjs_default_upload_dir:SURVEYJS_UPLOAD_DIR)%')
        ->arg('$maxBytes', '%env(int:default:surveyjs_default_upload_max_bytes:SURVEYJS_UPLOAD_MAX_BYTES)%');

    $services->set(SignedFileUrlService::class)
        ->arg('$secret', '%env(default:kernel.secret:SURVEYJS_FILE_URL_SECRET)%')
        ->arg('$defaultTtlSeconds', '%env(int:default:surveyjs_default_file_url_ttl_seconds:SURVEYJS_FILE_URL_TTL_SECONDS)%');

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
    $services->set(SurveysPublicController::class)
        ->arg('$licenseKey', '%env(default::SURVEYJS_LICENSE_KEY)%')
        ->tag('controller.service_arguments');
    $services->set(SurveysHealthController::class)->tag('controller.service_arguments');

    $services->set(SurveyJsStyleRegistrySubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsLookupRegistrySubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsRealtimeTopicSubscriber::class)->tag('kernel.event_subscriber');
};

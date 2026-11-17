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
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsDataAccessResourcesSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsLookupRegistrySubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsRealtimeTopicSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsSectionBindingSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsStyleRegistrySubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsUserDataCleanupSubscriber;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\SignedFileUrlService;
use Humdek\SurveyJsBundle\Service\SurveyAnswerNormalizer;
use Humdek\SurveyJsBundle\Service\SurveyDashboardService;
use Humdek\SurveyJsBundle\Service\SurveyDataInterpolator;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Humdek\SurveyJsBundle\Service\SurveyJsHealthCheck;
use Humdek\SurveyJsBundle\Service\SurveyJsHtmlSanitizer;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyPdfService;
use Humdek\SurveyJsBundle\Service\SurveyResponseDraftService;
use Humdek\SurveyJsBundle\Service\SurveyResponseService;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
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
            '../../Service/SurveyResponseRecord.php',
        ]);

    $services->set(SurveyRepository::class)->autowire();
    $services->set(SurveyVersionRepository::class)->autowire();
    $services->set(SurveyFileRepository::class)->autowire();

    $services->set(SurveyJsHtmlSanitizer::class)->autowire();
    $services->set(SurveyAnswerNormalizer::class)->autowire();
    $services->set(SurveyService::class)->autowire();
    $services->set(SurveyResponseService::class)->autowire();
    $services->set(SurveyResponseDraftService::class)->autowire();
    $services->set(SurveyResponseStore::class)->autowire();
    $services->set(SurveyDashboardService::class)->autowire();
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
    // Uploads default to the core form files directory, a kept volume
    // (backed up, survives updates), like core form uploads.
    $configurator->parameters()
        ->set('surveyjs_default_upload_dir', '%selfhelp.form_file_storage_dir%/surveyjs')
        ->set('surveyjs_default_upload_max_bytes', 25000000)
        ->set('surveyjs_default_file_url_ttl_seconds', 300);

    // Private file storage (outside web root). Defaults resolve to
    // `<form files dir>/surveyjs` when the env override is missing.
    $services->set(SurveyFileStorage::class)
        ->arg('$uploadDir', '%env(default:surveyjs_default_upload_dir:SURVEYJS_UPLOAD_DIR)%')
        ->arg('$maxBytes', '%env(int:default:surveyjs_default_upload_max_bytes:SURVEYJS_UPLOAD_MAX_BYTES)%');

    $services->set(SignedFileUrlService::class)
        ->arg('$secret', '%env(default:kernel.secret:SURVEYJS_FILE_URL_SECRET)%')
        ->arg('$defaultTtlSeconds', '%env(int:default:surveyjs_default_file_url_ttl_seconds:SURVEYJS_FILE_URL_TTL_SECONDS)%');

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
    $services->set(SurveyJsUserDataCleanupSubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsDataAccessResourcesSubscriber::class)->tag('kernel.event_subscriber');
    $services->set(SurveyJsSectionBindingSubscriber::class)->tag('kernel.event_subscriber');
};

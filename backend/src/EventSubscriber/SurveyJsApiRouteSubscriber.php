<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\ApiRouteRegistryEvent;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysAdminController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysHealthController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysLicenseController;
use Humdek\SurveyJsBundle\Controller\Api\V1\SurveysPublicController;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Registers the SurveyJS plugin's API routes with the host's
 * `ApiRouteLoader` through `ApiRouteRegistryEvent`. The host prepends
 * `/cms-api/<version>` to every contributed path, so the paths declared
 * here intentionally start at `/plugins/...` or `/admin/plugins/...`.
 *
 * The route names + paths mirror `plugin.json#apiRoutes` 1:1, which is
 * the manifest the host's `PluginCapabilityValidator` cross-checks.
 */
final class SurveyJsApiRouteSubscriber implements EventSubscriberInterface
{
    public const PLUGIN_ID = 'sh2-shp-survey-js';

    public static function getSubscribedEvents(): array
    {
        return [
            ApiRouteRegistryEvent::class => 'onApiRouteRegistry',
        ];
    }

    public function onApiRouteRegistry(ApiRouteRegistryEvent $event): void
    {
        $admin = SurveysAdminController::class;
        $public = SurveysPublicController::class;
        $license = SurveysLicenseController::class;
        $health = SurveysHealthController::class;

        $manage = ['surveyjs.surveys.manage'];
        $viewResp = ['surveyjs.surveys.view-responses'];
        $exportPdf = ['surveyjs.surveys.export-pdf'];

        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_list', '/admin/plugins/' . self::PLUGIN_ID . '/surveys', $admin . '::list', ['GET'], [], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_create', '/admin/plugins/' . self::PLUGIN_ID . '/surveys', $admin . '::create', ['POST'], [], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_get', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}', $admin . '::get', ['GET'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_update', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}', $admin . '::update', ['PUT'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_delete', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}', $admin . '::delete', ['DELETE'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_draft_save', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/draft', $admin . '::saveDraft', ['PUT'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_versions_create', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/versions', $admin . '::publishVersion', ['POST'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_versions_list', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/versions', $admin . '::versions', ['GET'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_versions_restore', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/versions/{versionId}/restore', $admin . '::restoreVersion', ['POST'], ['id' => '\d+', 'versionId' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_presence', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/presence', $admin . '::presence', ['POST'], ['id' => '\d+'], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_dashboard', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/dashboard', $admin . '::dashboard', ['GET'], ['id' => '\d+'], $viewResp);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_responses', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/responses', $admin . '::responses', ['GET'], ['id' => '\d+'], $viewResp);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_response_detail', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/responses/{rid}', $admin . '::responseDetail', ['GET'], ['id' => '\d+', 'rid' => '[A-Za-z0-9_-]+'], $viewResp);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_response_pdf', '/admin/plugins/' . self::PLUGIN_ID . '/surveys/{id}/responses/{rid}/pdf', $admin . '::responsePdf', ['GET'], ['id' => '\d+', 'rid' => '[A-Za-z0-9_-]+'], $exportPdf);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_license_key', '/admin/plugins/' . self::PLUGIN_ID . '/license-key', $license . '::__invoke', ['GET'], [], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_admin_health', '/admin/plugins/' . self::PLUGIN_ID . '/health', $health . '::__invoke', ['GET'], [], $manage);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_public_published', '/plugins/' . self::PLUGIN_ID . '/published/{key}', $public . '::published', ['GET'], ['key' => '[a-zA-Z0-9_-]+']);
        $event->addRoute(self::PLUGIN_ID, 'surveyjs_public_submit', '/plugins/' . self::PLUGIN_ID . '/published/{key}/submit', $public . '::submit', ['POST'], ['key' => '[a-zA-Z0-9_-]+']);
    }
}

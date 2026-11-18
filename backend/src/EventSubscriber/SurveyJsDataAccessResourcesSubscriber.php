<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\DataAccessResourcesEvent;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Lists the surveys on the core "Permissions for role" screen, under the
 * resource type `surveyjs_survey` the manifest declares (H6), so an admin can
 * grant a role rights on single surveys.
 */
final class SurveyJsDataAccessResourcesSubscriber implements EventSubscriberInterface
{
    public function __construct(private readonly SurveyRepository $surveys)
    {
    }

    public static function getSubscribedEvents(): array
    {
        return [DataAccessResourcesEvent::class => 'onResources'];
    }

    public function onResources(DataAccessResourcesEvent $event): void
    {
        if ($event->resourceTypeCode !== SurveyAccessService::RESOURCE_TYPE) {
            return;
        }
        foreach ($this->surveys->findAll() as $survey) {
            if ($survey->getId() !== null) {
                $event->addResource((int) $survey->getId(), $survey->getName(), $survey->getSurveyId());
            }
        }
    }
}

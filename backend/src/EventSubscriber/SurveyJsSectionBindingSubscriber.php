<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\SectionFieldBindingEvent;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Humdek\SurveyJsBundle\Service\SurveySectionResolver;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Placing a survey on a page needs a view grant on the survey (concept
 * section 6); the core checks the page update right. Runs when a section is
 * saved or imported (H7). A value that names no survey places nothing and is
 * allowed, as for an unknown data table.
 */
final class SurveyJsSectionBindingSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly SurveyRepository $surveys,
        private readonly SurveyAccessService $access,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [SectionFieldBindingEvent::class => 'onBinding'];
    }

    public function onBinding(SectionFieldBindingEvent $event): void
    {
        if (!in_array($event->fieldName, [SurveySectionResolver::FIELD_SURVEY, SurveySectionResolver::FIELD_SURVEY_OLD], true)) {
            return;
        }
        $survey = $this->surveys->findOneBySurveyId($event->value);
        if ($survey !== null && !$this->access->userCan($event->userId, $survey, SurveyAccessService::READ)) {
            $event->deny('You can only place surveys your role may see.');
        }
    }
}

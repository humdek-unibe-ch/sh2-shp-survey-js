<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\EventSubscriber;

use App\Entity\User;
use App\Plugin\Event\PluginRealtimePermissionEvent;
use App\Plugin\Realtime\PluginRealtimePublisherInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsRealtimeGrantSubscriber;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Survey events reach an open admin screen only when two things hold: the
 * user's stream is granted the survey's topics (the host delivers nothing
 * else), and each event carries the name `usePluginRealtime` listens for.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyJsRealtimeTest extends TestCase
{
    public function testAUserIsGrantedAnswersOfVisibleSurveysAndEditingOfEditableOnes(): void
    {
        $access = $this->createMock(SurveyAccessService::class);
        $access->method('canOpenAdmin')->willReturn(true);
        $access->method('readableSurveyIdsOrNull')->willReturn([1, 2]);
        $access->method('rightsFor')->willReturn([
            1 => ['update' => true, 'publish' => false, 'delete' => false],
            2 => ['update' => false, 'publish' => false, 'delete' => false],
        ]);

        $event = $this->grant($access, [$this->survey(1), $this->survey(2), $this->survey(3)]);

        self::assertSame(
            ['responses:1', 'editing:1', 'responses:2'],
            $event->getAllowedTopicIris(),
            'survey 3 is not visible to this user; survey 2 is visible but not editable',
        );
    }

    public function testAUserWithoutSurveyPermissionsIsGrantedNothing(): void
    {
        $access = $this->createMock(SurveyAccessService::class);
        $access->method('canOpenAdmin')->willReturn(false);
        $access->expects(self::never())->method('readableSurveyIdsOrNull');

        self::assertSame([], $this->grant($access, [$this->survey(1)])->getAllowedTopicIris());
    }

    public function testEventsAreNamedForTheTopicTheScreenListensTo(): void
    {
        $names = [];
        $host = $this->createMock(PluginRealtimePublisherInterface::class);
        $host->method('publish')->willReturnCallback(
            function (string $pluginId, string $topicKey, array $payload, array $options) use (&$names): void {
                $names[$payload['type']] = $options['event'];
            },
        );
        $publisher = new SurveyJsRealtimePublisher($host);
        $survey = $this->survey(18);

        $publisher->surveyDraftSaved($survey, 1);
        $publisher->surveyEditingPresence($survey, 1, 'Admin', 'editing');

        self::assertSame([
            'draft_saved' => 'plugin/sh2-shp-survey-js/surveys/18/editing',
            'presence' => 'plugin/sh2-shp-survey-js/surveys/18/editing',
        ], $names);
    }

    /** @param list<Survey> $surveys */
    private function grant(SurveyAccessService $access, array $surveys): PluginRealtimePermissionEvent
    {
        $repository = $this->createMock(SurveyRepository::class);
        $repository->method('findAllNewestFirst')->willReturn($surveys);
        $realtime = $this->createMock(PluginRealtimePublisherInterface::class);
        $realtime->method('resolveTopicIri')->willReturnCallback(
            static fn (string $pluginId, string $topicKey, array $params): string => (str_ends_with($topicKey, 'responses') ? 'responses' : 'editing') . ':' . $params['surveyId'],
        );

        $event = new PluginRealtimePermissionEvent(new User());
        (new SurveyJsRealtimeGrantSubscriber($repository, $access, $realtime))->onRealtimePermission($event);

        return $event;
    }

    private function survey(int $id): Survey
    {
        $survey = new Survey('Survey ' . $id, 'SV_' . $id);
        (new \ReflectionProperty(Survey::class, 'id'))->setValue($survey, $id);

        return $survey;
    }
}

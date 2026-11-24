<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Service\CMS\DataTableService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;
use Humdek\SurveyJsBundle\Service\SurveyJsRealtimePublisher;
use Humdek\SurveyJsBundle\Service\SurveyService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

/**
 * Issue #56 regression: a SurveyJS `question.name` is the immutable host
 * storage key (`data_cols.field_key`). {@see SurveyService::publishDraft}
 * must refuse to publish a version that renames or removes an answered
 * question (so old/new responses cannot fragment into two columns), while
 * still allowing title-only edits and additive questions, and allowing any
 * change while the survey has no responses yet.
 *
 * Pure unit tests: repositories, the EM, and the realtime publisher are
 * mocked; no database required (host backend rule: mocks are acceptable for
 * isolated service logic).
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyServicePublishGuardTest extends TestCase
{
    public function testPublishBlocksRenamingAnsweredQuestion(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        // Draft renames the storage key mood_score -> daily_mood.
        $survey->setDraftDefinition($this->singleQuestionDefinition('daily_mood', 'Daily mood'), null);

        $service = $this->buildService(completedRuns: 3);

        try {
            $service->publishDraft($survey, null);
            self::fail('Expected the rename of an answered question to be blocked.');
        } catch (\DomainException $e) {
            self::assertSame(409, $e->getCode(), 'an immutable-key violation must surface as HTTP 409');
            self::assertStringContainsString('mood_score', $e->getMessage(), 'the offending storage key must be named');
        }
    }

    public function testPublishBlocksRemovingAnsweredQuestion(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        // Draft drops mood_score entirely (only a new question remains).
        $survey->setDraftDefinition($this->singleQuestionDefinition('notes', 'Notes'), null);

        $service = $this->buildService(completedRuns: 1);

        $this->expectException(\DomainException::class);
        $this->expectExceptionCode(409);
        $service->publishDraft($survey, null);
    }

    public function testPublishAllowsTitleOnlyChange(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        // Same storage key, only the human label changes -> always allowed.
        $survey->setDraftDefinition($this->singleQuestionDefinition('mood_score', 'Daily mood'), null);

        $version = $this->buildService(completedRuns: 5)->publishDraft($survey, null);

        self::assertSame(2, $version->getRevision(), 'a title-only edit must publish a new revision');
    }

    public function testPublishAllowsRenameWhenNoResponsesExist(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $survey->setDraftDefinition($this->singleQuestionDefinition('daily_mood', 'Daily mood'), null);

        // No completed runs -> keys are still free to change.
        $version = $this->buildService(completedRuns: 0)->publishDraft($survey, null);

        self::assertSame(2, $version->getRevision(), 'with no responses a rename is permitted');
    }

    public function testPublishAllowsAddingNewQuestionAlongsideAnsweredOne(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $survey->setDraftDefinition([
            'pages' => [[
                'name' => 'page1',
                'elements' => [
                    ['type' => 'rating', 'name' => 'mood_score', 'title' => 'Mood score'],
                    ['type' => 'text', 'name' => 'notes', 'title' => 'Notes'],
                ],
            ]],
        ], null);

        $version = $this->buildService(completedRuns: 2)->publishDraft($survey, null);

        self::assertSame(2, $version->getRevision(), 'adding a new question must not be blocked');
    }

    public function testPublishIgnoresDisplayOnlyElementRemoval(): void
    {
        // An answered question stays; only a pure-display html block is removed.
        $survey = new Survey('Test', 'SV_HTML');
        $this->setEntityId($survey, 9);
        $published = new SurveyVersion($survey, 1, [
            'pages' => [[
                'name' => 'page1',
                'elements' => [
                    ['type' => 'text', 'name' => 'mood_score', 'title' => 'Mood score'],
                    ['type' => 'html', 'name' => 'intro_html', 'html' => '<p>hi</p>'],
                ],
            ]],
        ], null);
        $this->setEntityId($published, 91);
        $survey->setCurrentVersion($published);
        $survey->setDraftDefinition($this->singleQuestionDefinition('mood_score', 'Mood score'), null);

        $version = $this->buildService(completedRuns: 4)->publishDraft($survey, null);

        self::assertSame(2, $version->getRevision(), 'removing a display-only html block must not be blocked');
    }

    public function testPublishRefusesAQuestionNamedLikeASystemColumn(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $survey->setDraftDefinition([
            'pages' => [[
                'name' => 'page1',
                'elements' => [
                    ['type' => 'text', 'name' => 'mood_score', 'title' => 'Mood score'],
                    ['type' => 'text', 'name' => 'response_id', 'title' => 'Your id'],
                    ['type' => 'text', 'name' => 'id_users', 'title' => 'User'],
                ],
            ]],
        ], null);

        try {
            $this->buildService(completedRuns: 0)->publishDraft($survey, null);
            self::fail('Expected a question named like a data column to be refused.');
        } catch (\DomainException $e) {
            self::assertSame(422, $e->getCode());
            self::assertStringContainsString('"id_users", "response_id"', $e->getMessage(), 'every clashing name is listed');
        }
    }

    public function testPublishRefusesNamesTheDataTableCannotStore(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $survey->setDraftDefinition([
            'pages' => [[
                'name' => 'page1',
                'elements' => [
                    ['type' => 'text', 'name' => 'mood_score', 'title' => 'Mood score'],
                    ['type' => 'text', 'name' => 'Q 1', 'title' => 'With a space'],
                    ['type' => 'text', 'name' => 'q-2', 'title' => 'With a hyphen'],
                    ['type' => 'text', 'name' => 'deleted', 'title' => 'A core column'],
                    // A panel name is not a column: any name is fine.
                    ['type' => 'panel', 'name' => 'About you', 'elements' => [
                        ['type' => 'text', 'name' => 'age', 'title' => 'Age'],
                    ]],
                ],
            ]],
        ], null);

        try {
            $this->buildService(completedRuns: 0)->publishDraft($survey, null);
            self::fail('Expected names the core data table refuses to be refused at publish.');
        } catch (\DomainException $e) {
            self::assertSame(422, $e->getCode());
            self::assertStringContainsString('"deleted" are used by the system', $e->getMessage());
            self::assertStringContainsString('"Q 1", "q-2" may only use letters', $e->getMessage());
            self::assertStringNotContainsString('About you', $e->getMessage(), 'a panel name is not a column');
        }
    }

    public function testAQuestionNobodyAnsweredMayBeRemovedEvenWhenTheSurveyHasAnswers(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        // v2 added `notes`; nobody answered it yet.
        $withNotes = new SurveyVersion($survey, 2, [
            'pages' => [['name' => 'page1', 'elements' => [
                ['type' => 'rating', 'name' => 'mood_score', 'title' => 'Mood score'],
                ['type' => 'text', 'name' => 'notes', 'title' => 'Notes'],
            ]]],
        ], null);
        $this->setEntityId($withNotes, 13);
        $survey->setCurrentVersion($withNotes);
        $survey->setDraftDefinition($this->singleQuestionDefinition('mood_score', 'Mood score'), null);

        $version = $this->buildService(completedRuns: 3)->publishDraft($survey, null);

        self::assertSame(2, $version->getRevision(), 'removing the unanswered `notes` is allowed');
    }

    public function testRestoringAnOlderVersionWithoutAnUnansweredNewQuestionWorks(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $v1 = $survey->getCurrentVersion();
        self::assertNotNull($v1);
        $v2 = new SurveyVersion($survey, 2, [
            'pages' => [['name' => 'page1', 'elements' => [
                ['type' => 'rating', 'name' => 'mood_score', 'title' => 'Mood score'],
                ['type' => 'text', 'name' => 'my_answer', 'title' => 'New, unanswered'],
            ]]],
        ], null);
        $this->setEntityId($v2, 12);
        $survey->setCurrentVersion($v2);

        $this->buildService(completedRuns: 3)->restoreVersion($survey, $v1, null);

        self::assertSame(11, $survey->getCurrentVersion()?->getId(), 'v1 is current again');
    }

    public function testRestoringAVersionRunsThePublishGuards(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        // A version from before the name guard existed.
        $old = new SurveyVersion($survey, 2, $this->singleQuestionDefinition('page_no', 'Page'), null);
        $this->setEntityId($old, 12);

        try {
            $this->buildService(completedRuns: 0)->restoreVersion($survey, $old, null);
            self::fail('Expected restoring a version with a reserved name to be refused.');
        } catch (\DomainException $e) {
            self::assertSame(422, $e->getCode());
        }
        self::assertSame(11, $survey->getCurrentVersion()?->getId(), 'the version participants get is unchanged');
    }

    public function testRestoringAnotherSurveysVersionIsNotFound(): void
    {
        $survey = $this->surveyWithPublishedQuestion('mood_score', 'Mood score');
        $other = new Survey('Other', 'SV_OTHER');
        $this->setEntityId($other, 2);
        $foreign = new SurveyVersion($other, 1, $this->singleQuestionDefinition('mood_score', 'Mood score'), null);
        $this->setEntityId($foreign, 21);

        $this->expectException(\DomainException::class);
        $this->expectExceptionCode(404);
        $this->buildService(completedRuns: 0)->restoreVersion($survey, $foreign, null);
    }

    private function surveyWithPublishedQuestion(string $name, string $title): Survey
    {
        $survey = new Survey('Test', 'SV_' . strtoupper($name));
        $this->setEntityId($survey, 1);
        $published = new SurveyVersion($survey, 1, $this->singleQuestionDefinition($name, $title), null);
        $this->setEntityId($published, 11);
        $survey->setCurrentVersion($published);
        return $survey;
    }

    /**
     * @return array<string, mixed>
     */
    private function singleQuestionDefinition(string $name, string $title): array
    {
        return [
            'pages' => [[
                'name' => 'page1',
                'elements' => [
                    ['type' => 'text', 'name' => $name, 'title' => $title],
                ],
            ]],
        ];
    }

    private function buildService(int $completedRuns): SurveyService
    {
        $em = $this->createMock(EntityManagerInterface::class);
        // The immutable-key guard runs BEFORE the transaction. The allowed
        // cases don't need to exercise the persistence internals (the final
        // SurveyVersionRepository cannot be doubled), so the transaction just
        // returns a sentinel published version; a blocked case throws the 409
        // before this is ever reached.
        $em->method('wrapInTransaction')->willReturn($this->publishedSentinel());


        $surveys = (new \ReflectionClass(SurveyRepository::class))->newInstanceWithoutConstructor();
        \assert($surveys instanceof SurveyRepository);
        $versions = (new \ReflectionClass(SurveyVersionRepository::class))->newInstanceWithoutConstructor();
        \assert($versions instanceof SurveyVersionRepository);

        return new SurveyService(
            $em,
            $surveys,
            $versions,
            $this->createMock(SurveyJsRealtimePublisher::class),
            $this->tablesWithAnswersTo($completedRuns > 0 ? ['mood_score'] : null),
        );
    }

    /**
     * The survey's data table with a column per answered question, or none
     * before the first answer.
     *
     * @param list<string>|null $answered
     */
    private function tablesWithAnswersTo(?array $answered): DataTableService
    {
        $tables = $this->createMock(DataTableService::class);
        $tables->method('getColumnsNames')->willReturn($answered === null ? false : ['record_id', 'id_users', ...$answered]);

        return $tables;
    }

    private function publishedSentinel(): SurveyVersion
    {
        $survey = new Survey('Sentinel', 'SV_SENTINEL');
        $this->setEntityId($survey, 999);
        $version = new SurveyVersion($survey, 2, ['pages' => []], null);
        $this->setEntityId($version, 9999);
        return $version;
    }

    private function setEntityId(object $entity, int $id): void
    {
        $ref = new \ReflectionClass($entity);
        $prop = $ref->getProperty('id');
        $prop->setAccessible(true);
        $prop->setValue($entity, $id);
    }
}

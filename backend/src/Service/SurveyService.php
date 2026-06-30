<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyVersion;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Humdek\SurveyJsBundle\Repository\SurveyVersionRepository;

/**
 * Survey CRUD + version publishing.
 *
 * Wraps the entity-manager operations in transactions and emits the
 * relevant realtime events so the admin Survey Designer reflects
 * version bumps without polling.
 */
final class SurveyService
{
    /**
     * SurveyJS element types that never store user answers, so renaming or
     * removing them must NOT be blocked by the immutable-key guard.
     */
    private const NON_DATA_ELEMENT_TYPES = ['html', 'image'];

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyRepository $surveys,
        private readonly SurveyVersionRepository $versions,
        private readonly SurveyJsRealtimePublisher $realtime,
        private readonly SurveyRunRepository $runs,
    ) {
    }

    /**
     * @param array<string, mixed> $definition
     */
    public function createSurvey(string $name, array $definition, ?int $userId): Survey
    {
        $surveyId = $this->generateSurveyId();
        $definition = $this->normaliseDefinition($definition);

        return $this->em->wrapInTransaction(function () use ($name, $surveyId, $definition, $userId): Survey {
            $survey = new Survey($name, $surveyId, $definition);
            $survey->setDraftDefinition($definition, $userId);
            $this->em->persist($survey);
            $this->em->flush();
            return $survey;
        });
    }

    /**
     * @param array<string, mixed> $definition
     */
    public function publishNewVersion(Survey $survey, array $definition, ?int $userId): SurveyVersion
    {
        $this->saveDraft($survey, $definition, null, $userId, true);
        return $this->publishDraft($survey, $userId);
    }

    /**
     * @param array<string, mixed> $definition
     */
    public function saveDraft(Survey $survey, array $definition, ?string $expectedHash, ?int $userId, bool $force = false): Survey
    {
        $definition = $this->normaliseDefinition($definition);
        $currentHash = $survey->getDraftDefinitionSha256();
        if (!$force && $expectedHash !== null && $currentHash !== null && $expectedHash !== $currentHash) {
            throw new \DomainException('Draft has changed since it was loaded.', 409);
        }

        $survey->setDraftDefinition($definition, $userId);
        $this->em->flush();
        $this->realtime->surveyDraftSaved($survey, $userId);
        return $survey;
    }

    public function publishDraft(Survey $survey, ?int $userId): SurveyVersion
    {
        $definition = $this->normaliseDefinition($survey->getDraftDefinition() ?? $survey->getCurrentVersion()?->getDefinition() ?? []);

        // Issue #56: a question.name is the immutable storage key. Once a
        // survey has completed responses, renaming/removing an answered
        // question would orphan or fragment its host data column, so block
        // the publish (title-only edits and new questions stay allowed).
        $this->assertNoRenamedAnsweredQuestions($survey, $definition);

        return $this->em->wrapInTransaction(function () use ($survey, $definition, $userId): SurveyVersion {
            $revision = $this->versions->nextRevision($survey);
            $version = new SurveyVersion($survey, $revision, $definition, $userId);
            $this->em->persist($version);
            $survey->setCurrentVersion($version);
            $this->em->flush();

            $this->realtime->surveyVersionPublished($survey, $version, $userId);
            return $version;
        });
    }

    public function restoreVersion(Survey $survey, SurveyVersion $version, ?int $userId): Survey
    {
        if ($version->getSurvey()->getId() !== $survey->getId()) {
            throw new \DomainException('Version does not belong to this survey.');
        }

        $survey->setCurrentVersion($version);
        $survey->setDraftDefinition($version->getDefinition(), $userId);
        $this->em->flush();
        $this->realtime->surveyVersionPublished($survey, $version, $userId);
        return $survey;
    }

    public function archive(Survey $survey, bool $archived): Survey
    {
        $survey->setArchived($archived);
        $this->em->flush();
        return $survey;
    }

    public function delete(Survey $survey): void
    {
        $this->em->wrapInTransaction(function () use ($survey): void {
            $this->em->remove($survey);
            $this->em->flush();
        });
    }

    /**
     * Guard the immutable storage keys when publishing. If the survey already
     * has completed responses and the new definition drops a previously
     * published question/panel name, refuse the publish so the rename is an
     * explicit, data-aware decision rather than silent fragmentation.
     *
     * @param array<string, mixed> $newDefinition
     *
     * @throws \DomainException (code 409) when an answered name is renamed/removed.
     */
    private function assertNoRenamedAnsweredQuestions(Survey $survey, array $newDefinition): void
    {
        $current = $survey->getCurrentVersion();
        if ($current === null) {
            return;
        }
        if ($this->runs->countCompletedForSurvey($survey) === 0) {
            return;
        }

        $oldNames = $this->collectQuestionNames($current->getDefinition());
        $newNames = $this->collectQuestionNames($newDefinition);
        $removed = array_values(array_diff(array_keys($oldNames), array_keys($newNames)));

        if ($removed !== []) {
            sort($removed);
            throw new \DomainException(
                sprintf(
                    'Cannot publish: question name(s) "%s" already have stored responses and may not be renamed or removed. '
                    . 'Rename the question title instead (the title is only a display label), or add a new question with a new name.',
                    implode('", "', $removed)
                ),
                409
            );
        }
    }

    /**
     * Collect the set of answer-bearing element names (questions + panels) from
     * a survey definition. Page names are skipped (they never prefix answer
     * data); pure-display elements ({@see self::NON_DATA_ELEMENT_TYPES}) are
     * skipped so they can be freely added/removed.
     *
     * @param array<string, mixed> $node
     * @return array<string, true>
     */
    private function collectQuestionNames(array $node): array
    {
        $out = [];
        if (isset($node['pages']) && is_array($node['pages'])) {
            foreach ($node['pages'] as $page) {
                if (is_array($page)) {
                    $out += $this->collectQuestionNames($page);
                }
            }
        }
        if (isset($node['elements']) && is_array($node['elements'])) {
            foreach ($node['elements'] as $element) {
                if (!is_array($element)) {
                    continue;
                }
                $type = isset($element['type']) && is_string($element['type']) ? $element['type'] : '';
                if (
                    !in_array($type, self::NON_DATA_ELEMENT_TYPES, true)
                    && isset($element['name']) && is_string($element['name']) && $element['name'] !== ''
                ) {
                    $out[$element['name']] = true;
                }
                $out += $this->collectQuestionNames($element);
            }
        }
        return $out;
    }

    private function generateSurveyId(): string
    {
        do {
            $surveyId = 'SV_' . strtoupper(bin2hex(random_bytes(8)));
        } while ($this->surveys->findOneBySurveyId($surveyId) !== null);

        return $surveyId;
    }

    /**
     * @param array<string, mixed> $definition
     * @return array<string, mixed>
     */
    private function normaliseDefinition(array $definition): array
    {
        return $definition === [] ? ['pages' => []] : $definition;
    }
}

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
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyRepository $surveys,
        private readonly SurveyVersionRepository $versions,
        private readonly SurveyJsRealtimePublisher $realtime,
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

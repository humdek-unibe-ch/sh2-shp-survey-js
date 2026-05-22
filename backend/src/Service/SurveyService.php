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
    public function createSurvey(string $name, string $keySlug, array $definition, ?int $userId): Survey
    {
        if ($this->surveys->findOneByKeySlug($keySlug) !== null) {
            throw new \DomainException(sprintf('A survey with key "%s" already exists.', $keySlug));
        }

        return $this->em->wrapInTransaction(function () use ($name, $keySlug, $definition, $userId): Survey {
            $survey = new Survey($name, $keySlug);
            $this->em->persist($survey);
            $this->em->flush();

            $version = new SurveyVersion($survey, 1, $definition, $userId);
            $this->em->persist($version);
            $survey->setCurrentVersion($version);

            $this->em->flush();
            return $survey;
        });
    }

    /**
     * @param array<string, mixed> $definition
     */
    public function publishNewVersion(Survey $survey, array $definition, ?int $userId): SurveyVersion
    {
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
}

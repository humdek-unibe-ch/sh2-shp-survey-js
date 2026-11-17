<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\EventSubscriber;

use App\Plugin\Event\UserDataCleanupEvent;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Repository\SurveyFileRepository;
use Humdek\SurveyJsBundle\Service\SurveyFileStorage;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Removes the files a user uploaded to surveys when the core removes the
 * user's data (rule 2.11). The answers need nothing here: they are rows of
 * the core data store, which the core removes itself.
 *
 * The rows go inside the core's transaction; the files on disk only after
 * it committed, since a deleted file cannot roll back.
 */
final class SurveyJsUserDataCleanupSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly SurveyFileRepository $files,
        private readonly SurveyFileStorage $storage,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [UserDataCleanupEvent::class => 'onUserDataCleanup'];
    }

    public function onUserDataCleanup(UserDataCleanupEvent $event): void
    {
        $paths = [];
        foreach ($this->files->findByUploader($event->getUserId()) as $file) {
            $paths[] = $this->storage->resolvePath($file);
            $this->em->remove($file);
        }
        if ($paths === []) {
            return;
        }
        $this->em->flush();

        $event->afterCommit(static function () use ($paths): void {
            foreach ($paths as $path) {
                if (is_file($path)) {
                    @unlink($path);
                }
            }
        });
    }
}

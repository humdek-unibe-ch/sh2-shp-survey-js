<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Entity\DataTable;
use App\Entity\User;
use App\Plugin\Event\DataAccessResourcesEvent;
use App\Plugin\Event\SectionFieldBindingEvent;
use App\Service\CMS\Admin\AdminDataAccessService;
use App\Service\CMS\UserPermissionService;
use App\Service\Core\LookupService;
use App\Service\Core\UserContextAwareService;
use App\Service\Security\DataAccessSecurityService;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsDataAccessResourcesSubscriber;
use Humdek\SurveyJsBundle\EventSubscriber\SurveyJsSectionBindingSubscriber;
use Humdek\SurveyJsBundle\Repository\SurveyRepository;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * A survey is a resource of core data access (`surveyjs_survey`, H6): the
 * grant on the survey decides who edits it, the grant on its data table who
 * sees its answers, and placing it on a page needs a view grant (H7).
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyAccessTest extends TestCase
{
    private DataAccessSecurityService&MockObject $security;

    /** @var array<string, bool> "resourceType:resourceId:permission" => granted */
    private array $grants = [];

    private bool $admin = false;

    private ?DataTable $table = null;

    protected function setUp(): void
    {
        if (!class_exists(SectionFieldBindingEvent::class)) {
            self::markTestSkipped('Needs a host with SectionFieldBindingEvent (H7).');
        }
        $this->security = $this->createMock(DataAccessSecurityService::class);
        $this->security->method('userHasAdminRole')->willReturnCallback(fn (): bool => $this->admin);
        $this->security->method('hasPermission')->willReturnCallback(
            fn (int $userId, string $type, int $id, int $permission): bool => $this->admin || ($this->grants["$type:$id:$permission"] ?? false),
        );
    }

    public function testASurveyGrantIsCheckedUnderThePluginResourceType(): void
    {
        $this->grants['surveyjs_survey:4:' . SurveyAccessService::UPDATE] = true;

        self::assertTrue($this->access()->userCan(7, $this->survey(4), SurveyAccessService::UPDATE));
        self::assertFalse($this->access()->userCan(7, $this->survey(5), SurveyAccessService::UPDATE), 'a grant is per survey');
        self::assertFalse($this->access()->userCan(7, new Survey('New', 'SV_NEW'), SurveyAccessService::READ), 'a survey not yet saved has no grants');
    }

    public function testTheAnswersNeedTheGrantOnTheSurveysDataTable(): void
    {
        $this->table = $this->dataTable(31);
        $this->grants['data_table:31:' . SurveyAccessService::READ] = true;
        $access = $this->access(signedIn: true);

        self::assertTrue($access->canOnResponses($this->survey(4), SurveyAccessService::READ));
        self::assertFalse($access->canOnResponses($this->survey(4), SurveyAccessService::DELETE), 'reading the answers is not deleting them');
    }

    public function testBeforeTheFirstResponseOnlyTheAdminSeesTheAnswers(): void
    {
        self::assertFalse($this->access(signedIn: true)->canOnResponses($this->survey(4), SurveyAccessService::READ));

        $this->admin = true;
        self::assertTrue($this->access(signedIn: true)->canOnResponses($this->survey(4), SurveyAccessService::READ));
    }

    public function testAGuestHasNoRightsOnSurveysOrAnswers(): void
    {
        $this->admin = true;
        $access = $this->access(signedIn: false);

        self::assertFalse($access->can($this->survey(4), SurveyAccessService::READ));
        self::assertFalse($access->canOnResponses($this->survey(4), SurveyAccessService::READ));
    }

    public function testPlacingASurveyNeedsAViewGrantOnIt(): void
    {
        $this->grants['surveyjs_survey:4:' . SurveyAccessService::READ] = true;
        $surveys = $this->createMock(SurveyRepository::class);
        $surveys->method('findOneBySurveyId')->willReturnCallback(fn (string $key): ?Survey => match ($key) {
            'SV_SEEN' => $this->survey(4),
            'SV_HIDDEN' => $this->survey(5),
            default => null,
        });
        $subscriber = new SurveyJsSectionBindingSubscriber($surveys, $this->access());

        $hidden = new SectionFieldBindingEvent('survey_js', 'select-survey-js', 'SV_HIDDEN', 7);
        $subscriber->onBinding($hidden);
        self::assertNotNull($hidden->getDenial());

        foreach ([['survey_js', 'SV_SEEN'], ['survey_js', 'SV_UNKNOWN'], ['title', 'SV_HIDDEN']] as [$field, $value]) {
            $event = new SectionFieldBindingEvent($field, null, $value, 7);
            $subscriber->onBinding($event);
            self::assertNull($event->getDenial(), "$field=$value");
        }
    }

    public function testTheAdminScreenOffersAnActionOnlyWithItsPermissionAndTheMatchingGrant(): void
    {
        $surveys = [$this->survey(4), $this->survey(5), $this->survey(6)];
        $editor = ['surveyjs.survey.read', 'surveyjs.survey.update', 'surveyjs.survey.delete'];
        $masks = [
            4 => SurveyAccessService::READ | SurveyAccessService::UPDATE | SurveyAccessService::DELETE,
            5 => SurveyAccessService::READ,
        ];

        $rights = SurveyAccessService::rightsFromGrants($surveys, $editor, $masks);

        self::assertSame(['update' => true, 'publish' => false, 'delete' => true], $rights[4], 'no publish permission: no publish');
        self::assertSame(['update' => false, 'publish' => false, 'delete' => false], $rights[5], 'a view grant allows no change');
        self::assertSame(['update' => false, 'publish' => false, 'delete' => false], $rights[6], 'no grant at all');

        $publisher = SurveyAccessService::rightsFromGrants($surveys, ['surveyjs.survey.publish'], $masks);
        self::assertTrue($publisher[4]['publish'], 'publishing needs the publish permission and the update grant');
        self::assertFalse($publisher[4]['update'], 'publishing is not editing');
    }

    public function testTheAdminRoleMayDoWhatItsPermissionsAllowOnEverySurvey(): void
    {
        $all = ['surveyjs.survey.update', 'surveyjs.survey.publish', 'surveyjs.survey.delete'];

        $rights = SurveyAccessService::rightsFromGrants([$this->survey(4)], $all, null);

        self::assertSame(['update' => true, 'publish' => true, 'delete' => true], $rights[4]);
    }

    public function testOnlyARoleWithTheCreatePermissionMayCreateASurvey(): void
    {
        self::assertTrue($this->access(permissions: ['surveyjs.survey.read', 'surveyjs.survey.create'])->canCreate());
        self::assertFalse($this->access(permissions: ['surveyjs.survey.read'])->canCreate(), 'a read-only user gets no New Survey button');
        self::assertFalse($this->access(signedIn: false)->canCreate());
    }

    public function testTheRoleScreenListsTheSurveysUnderTheirOwnTypeOnly(): void
    {
        $surveys = $this->createMock(SurveyRepository::class);
        $surveys->method('findAll')->willReturn([$this->survey(4, 'Mood'), $this->survey(5, 'Sleep')]);
        $subscriber = new SurveyJsDataAccessResourcesSubscriber($surveys);

        $mine = new DataAccessResourcesEvent('surveyjs_survey');
        $subscriber->onResources($mine);
        self::assertSame(['Mood', 'Sleep'], array_column($mine->getResources(), 'name'));

        $other = new DataAccessResourcesEvent('pages');
        $subscriber->onResources($other);
        self::assertSame([], $other->getResources());
    }

    /**
     * @param list<string> $permissions
     */
    private function access(bool $signedIn = true, array $permissions = []): SurveyAccessService
    {
        $repository = $this->createMock(EntityRepository::class);
        $repository->method('findOneBy')->willReturnCallback(fn (): ?DataTable => $this->table);
        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('getRepository')->willReturn($repository);

        $user = $this->createMock(User::class);
        $user->method('getId')->willReturn(7);
        $userContext = $this->createMock(UserContextAwareService::class);
        $userContext->method('getCurrentUser')->willReturn($signedIn ? $user : null);

        $lookups = (new \ReflectionClass(LookupService::class))->newInstanceWithoutConstructor();

        $userPermissions = $this->createMock(UserPermissionService::class);
        $userPermissions->method('getUserPermissions')->willReturn($permissions);

        return new SurveyAccessService($em, $this->security, $this->createMock(AdminDataAccessService::class), $lookups, $userContext, $userPermissions);
    }

    private function survey(int $id, string $name = 'Test'): Survey
    {
        $survey = new Survey($name, 'SV_' . $id);
        (new \ReflectionProperty(Survey::class, 'id'))->setValue($survey, $id);

        return $survey;
    }

    private function dataTable(int $id): DataTable
    {
        $table = $this->createMock(DataTable::class);
        $table->method('getId')->willReturn($id);

        return $table;
    }
}

<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Entity\Lookup;
use App\Entity\Page;
use App\Entity\User;
use App\Exception\ServiceException;
use App\Service\CMS\CmsPreferenceService;
use App\Service\CMS\Effective\EffectivePage;
use App\Service\CMS\Effective\PublicSectionAccessService;
use App\Service\CMS\Effective\PublicSectionScope;
use App\Service\Core\InterpolationService;
use App\Service\Core\UserContextAwareService;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Service\SurveySectionResolver;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;

/**
 * A public survey call names its page and section; the settings that limit
 * the participant are read from that published section on the server, never
 * from the request (rule 7.7, problem 1). The core access check is mocked;
 * the section is a real scope.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveySectionResolverTest extends TestCase
{
    /** @var array<string, array<int, string>> */
    private array $fields = [];

    protected function setUp(): void
    {
        // Reads a real section through the core; the plugin-only CI has stubs.
        if (!class_exists(EffectivePage::class)) {
            self::markTestSkipped('Needs the SelfHelp backend (run inside the host).');
        }
    }

    private ?User $user = null;

    public function testTheSettingsComeFromTheSectionNotFromTheRequest(): void
    {
        $this->fields = [
            'survey_js' => [1 => 'SV_TEST'],
            'once_per_user' => [1 => '1'],
            'start_time' => [1 => '08:00'],
            'end_time' => [1 => '12:00'],
            'timeout' => [1 => '15'],
            'auto_save_interval' => [1 => 'soon'],
            'save_pdf' => [1 => 'true'],
            'label_survey_done' => [1 => 'Done', 3 => 'Fertig'],
            'label_survey_not_active' => [1 => 'Closed'],
        ];
        $request = Request::create('/x', 'POST', ['page_id' => '7', 'section_id' => '5', 'language_id' => '3'], [], [], [], json_encode([
            'oncePerUser' => false,
            'allowAnonymous' => false,
            'config' => ['oncePerUser' => false],
        ]) ?: null);

        $settings = $this->resolver()->resolve($request, new Survey('Test', 'SV_TEST'));

        self::assertTrue($settings->oncePerUser, 'the request cannot switch a limit off');
        self::assertTrue($settings->allowAnonymous, 'an empty allow_anonymous means open, as before');
        self::assertFalse($settings->oncePerSchedule);
        self::assertSame('08:00', $settings->startTime);
        self::assertSame(15, $settings->timeoutMinutes);
        self::assertSame(0, $settings->autoSaveIntervalSeconds, 'a value that is not a number counts as none');
        self::assertTrue($settings->savePdf);
        self::assertSame('Fertig', $settings->labelSurveyDone, 'labels in the page language');
        self::assertSame('Closed', $settings->labelSurveyNotActive, 'falling back to the stored text');
        self::assertSame(3, $settings->languageId);
        self::assertSame('Europe/Zurich', $settings->timezone->getName(), 'a guest gets the CMS default timezone');
    }

    public function testAnUpdateBasedOnColumnTheCoreReservesIsIgnored(): void
    {
        // The core drops `record` on save; keying rows by it would never find a row again.
        $this->fields = ['survey_js' => [1 => 'SV_TEST'], 'update_based_on' => [1 => 'record']];
        $request = Request::create('/x', 'GET', ['page_id' => '7', 'section_id' => '5']);
        self::assertNull($this->resolver()->resolve($request, new Survey('Test', 'SV_TEST'))->updateBasedOn);

        $this->fields['update_based_on'] = [1 => 'visit'];
        self::assertSame('visit', $this->resolver()->resolve($request, new Survey('Test', 'SV_TEST'))->updateBasedOn);
    }

    public function testASignedInParticipantsOwnTimezoneWins(): void
    {
        $this->fields = ['survey_js' => [1 => 'SV_TEST']];
        $this->user = new User();
        $this->user->setTimezone((new Lookup())->setLookupCode('America/New_York'));

        $settings = $this->resolver()->resolve(Request::create('/x', 'GET', ['page_id' => '7', 'section_id' => '5']), new Survey('Test', 'SV_TEST'));

        self::assertSame('America/New_York', $settings->timezone->getName());
    }

    public function testACallWithoutPageOrSectionIsRefused(): void
    {
        $this->fields = ['survey_js' => [1 => 'SV_TEST']];

        foreach ([[], ['page_id' => '7'], ['page_id' => '0', 'section_id' => '5'], ['page_id' => 'x', 'section_id' => '5']] as $query) {
            try {
                $this->resolver()->resolve(Request::create('/x', 'GET', $query), new Survey('Test', 'SV_TEST'));
                self::fail('A call must name its page and section.');
            } catch (ServiceException $e) {
                self::assertSame(400, $e->getCode());
            }
        }
    }

    public function testAPagePublishedBeforeTheRenameStillShowsItsSurvey(): void
    {
        $this->fields = ['survey-js' => [1 => 'SV_TEST']];

        $settings = $this->resolver()->resolve(Request::create('/x', 'GET', ['page_id' => '7', 'section_id' => '5']), new Survey('Test', 'SV_TEST'));

        self::assertTrue($settings->allowAnonymous, 'the section resolves through the old field name');
    }

    public function testASectionShowingAnotherSurveyIsRefused(): void
    {
        $this->fields = ['survey_js' => [1 => 'SV_OTHER']];

        $this->expectException(ServiceException::class);
        $this->expectExceptionMessage('another survey');
        $this->resolver()->resolve(Request::create('/x', 'GET', ['page_id' => '7', 'section_id' => '5']), new Survey('Test', 'SV_TEST'));
    }

    public function testThePageSectionAndPreviewGoToTheCoreAccessCheck(): void
    {
        $this->fields = ['survey_js' => [1 => 'SV_TEST']];
        $access = $this->createMock(PublicSectionAccessService::class);
        $access->expects(self::once())->method('forSection')->with(7, 5, 'surveyjs', true)->willReturn($this->scope());

        $this->resolver($access)->resolve(Request::create('/x', 'GET', ['page_id' => '7', 'section_id' => '5', 'preview' => '1']), new Survey('Test', 'SV_TEST'));
    }

    private function resolver(?PublicSectionAccessService $access = null): SurveySectionResolver
    {
        if ($access === null) {
            $access = $this->createMock(PublicSectionAccessService::class);
            $access->method('forSection')->willReturn($this->scope());
        }
        $userContext = $this->createMock(UserContextAwareService::class);
        $userContext->method('getCurrentUser')->willReturnCallback(fn (): ?User => $this->user);
        $preferences = $this->createMock(CmsPreferenceService::class);
        $preferences->method('getDefaultTimezone')->willReturn((new Lookup())->setLookupCode('Europe/Zurich'));

        return new SurveySectionResolver($access, $this->createMock(InterpolationService::class), $userContext, $preferences);
    }

    private function scope(): PublicSectionScope
    {
        $fields = $this->fields;
        $page = EffectivePage::draft(7, [['id' => 5, 'style_name' => 'surveyjs']], static fn (): array => $fields);

        return new PublicSectionScope(new Page(), $page, 5, $fields);
    }
}

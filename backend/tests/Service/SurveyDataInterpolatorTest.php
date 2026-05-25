<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use Humdek\SurveyJsBundle\Service\SurveyDataInterpolator;
use PHPUnit\Framework\TestCase;

/**
 * Covers the SurveyJS `{{token}}` interpolation. The tests target the
 * security invariants the legacy plugin lacked:
 *   - only explicitly declared tokens are substituted;
 *   - URL parameters cannot inject new tokens (only override declared
 *     ones);
 *   - dangerous JSON characters are escaped (the legacy plugin
 *     concatenated raw strings into the JSON which allowed quote
 *     injection);
 *   - URL params are exported under the `extra_param_<key>` prefix
 *     to keep parity with the legacy widget naming.
 */
final class SurveyDataInterpolatorTest extends TestCase
{
    public function testDeclaredTokensAreSubstituted(): void
    {
        $interp = new SurveyDataInterpolator();
        $definition = [
            'title' => 'Hello {{user_name}}',
            'pages' => [[ 'elements' => [['type' => 'text', 'title' => '{{question_one}}']] ]],
        ];
        $result = $interp->apply(
            $definition,
            ['tokens' => ['user_name' => 'Friend', 'question_one' => 'Your age?']],
            [],
            [],
        );
        self::assertSame('Hello Friend', $result['definition']['title']);
        self::assertSame('Your age?', $result['definition']['pages'][0]['elements'][0]['title']);
    }

    public function testUnknownTokensAreLeftIntact(): void
    {
        $interp = new SurveyDataInterpolator();
        $definition = ['title' => 'Hello {{unknown}}'];
        $result = $interp->apply($definition, [], [], []);
        self::assertSame('Hello {{unknown}}', $result['definition']['title']);
    }

    public function testUrlParamsCannotInjectNewTokens(): void
    {
        $interp = new SurveyDataInterpolator();
        $result = $interp->apply(
            ['title' => 'Hello {{evil}}'],
            ['tokens' => ['user_name' => 'Friend']],
            [],
            ['evil' => '"}, {"injected": true'],
        );
        // The `evil` token was not declared so it remained untouched
        // and the JSON injection attempt has no effect.
        self::assertSame('Hello {{evil}}', $result['definition']['title']);
    }

    public function testJsonEscapingPreventsInjection(): void
    {
        $interp = new SurveyDataInterpolator();
        $result = $interp->apply(
            ['title' => 'Hello {{user_name}}'],
            ['tokens' => ['user_name' => 'Friend']],
            ['user_name' => 'attacker", "extra": "evil'],
            [],
        );
        self::assertIsString($result['definition']['title']);
        self::assertStringContainsString('attacker', $result['definition']['title']);
        self::assertArrayNotHasKey('extra', $result['definition']);
    }

    public function testExtraParamsArePrefixed(): void
    {
        $interp = new SurveyDataInterpolator();
        $result = $interp->apply(
            ['title' => 'Hello'],
            [],
            [],
            ['code' => 'abc', 'lang' => 'en'],
        );
        self::assertSame(['extra_param_code' => 'abc', 'extra_param_lang' => 'en'], $result['extraParams']);
    }
}

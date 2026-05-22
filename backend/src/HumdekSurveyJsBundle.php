<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle;

use Symfony\Component\HttpKernel\Bundle\AbstractBundle;
use Symfony\Component\DependencyInjection\Loader\PhpFileLoader;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * SurveyJS v2 Symfony bundle.
 *
 * Registered dynamically by the host's `config/selfhelp_plugin_bundles.php`
 * file when the plugin is installed + enabled. Loading happens through the
 * usual `bundles.php` discovery; the host installer is responsible for
 * keeping that file in sync with `plugins` table state.
 */
final class HumdekSurveyJsBundle extends AbstractBundle
{
    protected string $extensionAlias = 'humdek_surveyjs';

    public function loadExtension(array $config, ContainerBuilder $builder, ?PhpFileLoader $loader = null): void
    {
        if ($loader === null) {
            $loader = new PhpFileLoader($builder, new \Symfony\Component\Config\FileLocator($this->getPath() . '/Resources/config'));
        }
        $loader->load('services.php');
    }

    public function getPath(): string
    {
        return \dirname(__DIR__);
    }
}

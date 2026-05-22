<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle;

use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

/**
 * SurveyJS v2 Symfony bundle.
 *
 * Registered dynamically by the host's `config/selfhelp_plugin_bundles.php`
 * file when the plugin is installed + enabled. Loading happens through the
 * usual `bundles.php` discovery; the host installer is responsible for
 * keeping that file in sync with `plugins` table state.
 *
 * Symfony 7.4's `AbstractBundle::loadExtension()` declares the signature as
 * `(array $config, ContainerConfigurator $configurator, ContainerBuilder $container)`.
 * We import the configurator's `service(...)` helper inside
 * `Resources/config/services.php`, so the configurator handle is passed
 * straight through to the PHP loader.
 */
final class HumdekSurveyJsBundle extends AbstractBundle
{
    protected string $extensionAlias = 'humdek_surveyjs';

    public function loadExtension(array $config, ContainerConfigurator $configurator, ContainerBuilder $container): void
    {
        $configurator->import($this->getPath() . '/Resources/config/services.php');
    }

    public function getPath(): string
    {
        return \dirname(__DIR__);
    }
}

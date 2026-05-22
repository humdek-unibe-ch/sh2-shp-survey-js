/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Module-level capture of the host `IPluginApi`.
 *
 * The host calls `register(api)` exactly once per plugin per process,
 * so we store the api here so deeper modules (admin pages, custom
 * Creator property editors, the GPX style) can read it without
 * relying on React context plumbing.
 *
 * Always call `setPluginApi()` at the top of `register()` so all
 * downstream consumers see the same instance.
 */
import type { IPluginApi } from '@selfhelp/shared/plugin-sdk';

let captured: IPluginApi | null = null;

export function setPluginApi(api: IPluginApi): void {
    captured = api;
}

export function getPluginApi(): IPluginApi | null {
    return captured;
}

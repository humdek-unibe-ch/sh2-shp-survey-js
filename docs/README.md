<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->
# SurveyJS Plugin Documentation

Audience: Plugin developers, SelfHelp technical operators, survey authors, and AI coding agents.
Status: active.
Applies to: `sh2-shp-survey-js` plugin documentation.
Last verified: 2026-06-03.
Source of truth: Plugin source code, `plugin.json`, host plugin docs, and this repository's `AGENTS.md`.

Navigation entrypoint for the SurveyJS plugin documentation, organized by audience and purpose per the Documentation Rules in `AGENTS.md`. The root [../README.md](../README.md) is the short overview and local-dev quick start.

## Start here

| Need | Read |
| --- | --- |
| Create, publish, restore, embed, and configure surveys | [user/user-guide.md](user/user-guide.md) |
| Install the plugin into a SelfHelp host | [operations/install.md](operations/install.md) |
| Publish a plugin release | [operations/publish.md](operations/publish.md) |
| Understand plugin internals | [developer/architecture.md](developer/architecture.md) |
| The exact `plugin.json` contract | [reference/manifest.md](reference/manifest.md) |

## Documentation map

| Folder | Use for |
| --- | --- |
| [developer/](developer/index.md) | Plugin architecture, data flow, security, and manual QA scenarios. |
| [operations/](operations/index.md) | Install, publish, and CI signing/secrets runbooks. |
| [reference/](reference/index.md) | The `plugin.json` manifest contract: capabilities, permissions, routes, owned tables, realtime topics, feature flags, styles, and config. |
| [user/](user/index.md) | Non-technical survey author and mobile end-user walkthroughs. |

## Conventions

- Every active doc starts with the metadata block (`Audience`, `Status`, `Applies to`, `Last verified`, `Source of truth`).
- Filenames use lowercase kebab-case; this file (`README.md`) is the only uppercase docs entrypoint, and subfolder indexes are `index.md`.
- The plugin source code, `plugin.json`, scripts, and workflows are the source of truth. When a doc conflicts with them, the code wins and the doc is corrected.
- `docs/plugins/plugin-manifest.schema.json` is a vendored copy of the host's canonical schema and is kept for offline validation.

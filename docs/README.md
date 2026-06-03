# SurveyJS Plugin Documentation

Audience: plugin developers, SelfHelp technical operators, survey authors, and AI coding agents.
Status: active documentation index.
Applies to: `sh2-shp-survey-js` plugin docs in this repository.
Last verified: 2026-06-03.
Source of truth: plugin source code, `plugin.json`, host plugin docs, and this repository's `AGENTS.md`.

Use this page as the navigation entrypoint for SurveyJS plugin documentation. The current docs already separate technical and user-facing concerns; new or substantially rewritten docs should follow the audience-based placement rules in `AGENTS.md`.

## Start Here

| Need | Read |
| --- | --- |
| Create, publish, restore, embed, and configure surveys | [user-guide.md](user-guide.md) |
| Install the plugin into a SelfHelp host | [install.md](install.md) |
| Understand plugin internals | [architecture.md](architecture.md) |
| Publish a plugin release | [publish.md](publish.md) |
| Validate behavior manually | [qa-scenarios.md](qa-scenarios.md) |

## Current Documentation Map

| Current doc | Purpose | Future placement rule |
| --- | --- | --- |
| [architecture.md](architecture.md) | Developer architecture and data flow. | Move to `docs/developer/` only after links are updated. |
| [qa-scenarios.md](qa-scenarios.md) | Developer/manual QA scenarios. | Move to `docs/developer/` or `docs/reference/` only after links are updated. |
| [install.md](install.md) | Host installation and enablement. | Move to `docs/operations/` only after links are updated. |
| [publish.md](publish.md) | Release and registry publishing workflow. | Move to `docs/operations/` only after links are updated. |
| [secrets-setup.md](secrets-setup.md) | GitHub Actions signing/registry secret setup. | Move to `docs/operations/` only after links are updated. |
| [user-guide.md](user-guide.md) | Non-technical survey author workflow. | Move to `docs/user/` only after links are updated. |
| [mobile-guide.md](mobile-guide.md) | Mobile behavior for end users/operators. | Move to `docs/user/` only after links are updated. |

## New Documentation Placement

| Folder | Use for |
| --- | --- |
| `docs/developer/` | Plugin backend/frontend/mobile architecture, tests, QA, and implementation tradeoffs. |
| `docs/user/` | Non-technical survey author, CMS admin, and operator feature walkthroughs. |
| `docs/reference/` | Exact API routes, manifest fields, permissions, realtime topics, schemas, and compatibility tables. |
| `docs/cookbook/` | Step-by-step recipes for adding question types, admin pages, mobile renderers, tests, or release changes. |
| `docs/operations/` | Install, publish, signing, CI secrets, registry, and recovery runbooks. |
| `docs/archive/` | Historical notes and superseded implementation summaries. |

When moving existing docs, update all repository-relative links in the same change and prefer small batches over broad rewrites.

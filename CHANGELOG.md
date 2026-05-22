# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).

## Unreleased

### Changed

- `plugin.json` `compatibility.selfhelp` bumped from `^2.0` to
  `>=8.0.0-dev <9.0.0` so the install policy accepts the current
  SelfHelp host (which reports `8.0.0-dev`). Standard caret/tilde
  semver ranges exclude pre-release identifiers like `-dev`, so the
  explicit range is required for development hosts.

### Docs

- `docs/install.md` and `docs/publish.md` rewritten to drop every
  `plugins.example.org` placeholder and point exclusively at the
  official Humdek registry at
  <https://github.com/humdek-unibe-ch/sh2-plugin-registry>. The
  install guide now covers the new drag-and-drop / file-picker /
  Monaco-editor options in the host UI and an "Optional — adding
  additional plugin sources" section for private mirrors.

### Added

- `scripts/publish-to-registry.ps1` and `scripts/publish-to-registry.sh`:
  one-shot scripts that validate the manifest, build the frontend +
  mobile packages, copy `plugin.json` into the sibling
  `sh2-plugin-registry/manifests/` folder, update its `registry.json`,
  commit the change, and optionally push. PowerShell + Bash scripts are
  functionally identical.
- `.github/workflows/publish-to-registry.yml`: CI workflow that runs
  the same publish flow on `v*` tag pushes and on manual dispatch
  (with a `channel` input). Uses a `REGISTRY_PUSH_TOKEN` secret to
  push into `humdek-unibe-ch/sh2-plugin-registry`; absence of the
  secret degrades to "build + validate only" with a CI warning.
- `docs/publish.md` now opens with a **fast path** section describing
  the publish script + workflow. The original manual steps remain
  for power users.
- `AGENTS.md` gains a "Plugin Registry / Publishing Rules" section
  declaring publish scripts + workflow as a mandatory plugin
  deliverable.

## [0.1.0] — 2026-05-22 (pre-release)

### Added

- End-user [Install guide](docs/install.md) covering the three install paths (UI registry → Available tab; UI local paste; terminal one-shot via `scripts/install-local.{ps1,sh}`).
- End-user [Publish guide](docs/publish.md) explaining how to publish the plugin so admins can install it from the new **Available** tab.
- Cross-platform install scripts under `scripts/`:
  - `install-local.ps1` — Windows / PowerShell.
  - `install-local.sh` — macOS / Linux / WSL.
  Both add a Composer path repo, call `selfhelp:plugin:install`, and run `npm link` on the frontend/mobile packages so the host dev servers resolve the plugin without a registry round-trip.
- End-user [User guide](docs/user-guide.md) and [Mobile guide](docs/mobile-guide.md) covering survey creation, publishing, version comparison/restore, embedding via the `surveyjs` style, response collection, and mobile behaviour.
- Vendored copy of the host's `plugin-manifest.schema.json` under `docs/plugins/` so CI manifest validation works without a public host repo checkout.
- PHPStan host-event stubs (`backend/stubs/host-events.php`) so the plugin lints cleanly outside the host autoload path.

### Changed

- **Versioning**: bumped to `0.1.0` across `plugin.json`, `frontend/package.json`, and `mobile/package.json` to reflect pre-release status (no public 1.x has shipped yet).
- **Package alignment**: plugin frontend now declares peers compatible with the host frontend stack — React `^19.2.0`, Mantine `^9.0.0`, `@selfhelp/shared` `^1.0.4`. Mobile peer set narrowed to React `^19.2.0`, React Native `^0.83.0`, `@selfhelp/shared` `^1.0.4`. Tiptap is no longer declared as a runtime dep — the plugin uses the host's Tiptap via `IRichTextEditorAdapter`.
- Bumped peer + dev dependency on `@selfhelp/shared` to `^1.0.4` (now exports `usePluginRealtime` + Tiptap adapter types).
- Survey Designer + runtime style now render through Mantine primitives (`Paper`, `Alert`, `Loader`, `Stack`, `Box`) for consistent admin UX.
- `HumdekSurveyJsBundle::loadExtension()` updated to the Symfony 7.4 `AbstractBundle` signature; `services.php` now imports the configurator's `service()` helper explicitly.
- `validate-plugin` workflow now (a) falls back to the vendored manifest schema when the host repo is private, (b) drops `npm ci` in favour of `npm install --legacy-peer-deps` so plugin lock-less repos no longer fail the "lock missing" branch.

### Fixed

- Backend `SurveysAdminController::update()` no longer relies on an unreachable `$body['themeCode'] === null` branch (use `array_key_exists()` instead of `isset()` so explicit null clears the theme).

## Pre-`0.1.0` (initial development)

Folded into `0.1.0` above. Initial development scope:

- Backend Symfony bundle with `Survey`, `SurveyVersion`, `SurveyRun`, `SurveyAnswerLink` entities.
- Public + admin API routes under `/cms-api/v1/admin/plugins/surveyjs/*` and `/cms-api/v1/plugins/surveyjs/*`.
- Frontend npm package contributing the `surveyjs` runtime style + `gpxMap` standalone style.
- Mantine theme bridge for both the SurveyJS Creator and the runtime renderer.
- Tiptap-based rich-text question + Creator property editors via the host `IRichTextEditorAdapter`.
- Optional GPX (Leaflet) and Video question types behind feature flags.
- Readonly mobile package with an "Open on web" fallback for unsupported question types.
- Mercure-driven realtime topics: `surveys/{surveyId}/editing` for collaborative editing and `surveys/{surveyId}/responses` for live response streams.
- Health-check endpoint + service id `humdek.surveyjs.health_check`.
- Admin-only license-key endpoint (env var `SURVEYJS_LICENSE_KEY`).

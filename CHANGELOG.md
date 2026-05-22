# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).

## Unreleased

### Added

- End-user [User guide](docs/user-guide.md) and [Mobile guide](docs/mobile-guide.md) covering survey creation, publishing, version comparison/restore, embedding via the `surveyjs` style, response collection, and mobile behaviour.
- Vendored copy of the host's `plugin-manifest.schema.json` under `docs/plugins/` so CI manifest validation works without a public host repo checkout.
- PHPStan host-event stubs (`backend/stubs/host-events.php`) so the plugin lints cleanly outside the host autoload path.

### Changed

- Bumped peer + dev dependency on `@selfhelp/shared` to `^1.0.4` (now exports `usePluginRealtime` + Tiptap adapter types).
- Survey Designer + runtime style now render through Mantine primitives (`Paper`, `Alert`, `Loader`, `Stack`, `Box`) for consistent admin UX.
- `HumdekSurveyJsBundle::loadExtension()` updated to the Symfony 7.4 `AbstractBundle` signature; `services.php` now imports the configurator's `service()` helper explicitly.
- `validate-plugin` workflow now (a) falls back to the vendored manifest schema when the host repo is private, (b) drops `npm ci` in favour of `npm install --legacy-peer-deps` so plugin lock-less repos no longer fail the "lock missing" branch.

### Fixed

- Backend `SurveysAdminController::update()` no longer relies on an unreachable `$body['themeCode'] === null` branch (use `array_key_exists()` instead of `isset()` so explicit null clears the theme).

## [1.0.0] — 2026-05-21

### Added

- Initial release of the SurveyJS v2 plugin.
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

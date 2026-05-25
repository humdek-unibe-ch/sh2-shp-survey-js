# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).

## Unreleased

### Added

- Legacy `sh-shp-survey_js` plugin parity: anonymous submissions via
  signed `_sh_sjs_vid` visitor cookie (`VisitorIdResolver`), cross-device
  draft autosave with server-side `survey_response_drafts` table +
  client-side `LocalDraftStore`, client-side `CountdownTimer` timeout
  enforcement, schedule (`start_time`/`end_time`) gating, edit mode via
  `?record_id=`, URL-parameter forwarding through `extra_param_<key>`
  SurveyJS variables, and the `label_survey_done` / `label_survey_not_active`
  Markdown messages.
- Secure file pipeline: new `SurveyFile` entity + `SurveyFileStorage`
  (private uploads under `var/plugin-data/sh2-shp-survey-js/uploads/`),
  HMAC-signed download URLs via `SignedFileUrlService`, SurveyJS
  upload/download/clear events wired through the plugin's secure
  `/files` endpoints, and graceful promotion of draft files to runs on
  submission.
- All four custom question types: rich-text (via the host's Tiptap
  adapter), video (with required-watch segment enforcement), GPX
  (file picker → in-browser parse → Leaflet preview → upload), and
  microphone (`MediaRecorder` → upload pipeline). Each is gated by an
  individual feature flag so existing surveys keep working.
- Server-side `{{token}}` interpolation (`SurveyDataInterpolator`) with
  JSON-injection-safe substitution. Tokens declared in `data_config` /
  `dynamic_replacement` are replaced inline; URL params can override
  declared tokens but cannot inject new ones.
- Server-side export endpoints for CSV (UTF-8 BOM, Excel-friendly
  delimiters), XLSX (when `phpoffice/phpspreadsheet` is installed) and
  JSON (streaming so wide surveys do not buffer in PHP memory). Per-
  response PDF endpoint (`/responses/{rid}/pdf`) uses `dompdf/dompdf`
  when available, gracefully falls back to a print-friendly HTML page
  otherwise.
- Runtime "Save as PDF" navigation button gated by the `save_pdf`
  section field. Uses `survey-pdf` when installed, falls back to the
  browser print dialog so the button keeps working everywhere.
- Dashboard rewrite: Tabulator-backed results table with persisted
  column layout per survey, SurveyAnalytics chart panel (with
  graceful fallback when the optional `survey-analytics` package isn't
  installed), Mantine-themed export menu, realtime refresh on
  `surveys/{surveyId}/responses`, and a new "Versions" tab listing
  every published revision with restore support.
- Responses page enhancements: filter input, per-row delete + open-PDF
  actions, server-side export menu, realtime live updates.
- `surveyjs.surveys.delete-responses`, `surveyjs.surveys.export-csv|
  xlsx|json`, `surveyjs.surveys.upload-files` permissions wired
  through `plugin.json` and seeded by Doctrine migration
  `Version20260525200000`.
- Backend tests under `backend/tests/Service/` for
  `SignedFileUrlService`, `SurveyDataInterpolator`, and
  `VisitorIdResolver`. Frontend Vitest scaffolding under
  `frontend/tests/` covers `markdown`, `LocalDraftStore`,
  `CountdownTimer`, and `extractUrlParams`.
- QA scenarios catalogue at `docs/qa-scenarios.md` documenting every
  legacy-parity behaviour we expect operators to validate against.

## [0.2.2] — Unreleased

### Added

- `response_id` is now written into every CMS form-data row created by
  `CoreDataTableWriter` (cell is auto-created in `data_cols` on first
  submission). Operators can now look at a row in CMS Data Management
  and trace it straight back to a survey response in the dashboard
  without having to join the plugin-owned `survey_runs` table.
- Server-side enforcement of `once_per_user` / `once_per_schedule` in
  `SurveyResponseService::submit`. The runtime forwards the section's
  flags through a new `enforce: { oncePerUser, windowStart, windowEnd }`
  payload field; the backend rejects duplicate completions with
  HTTP 409 (`reason` discriminator: `already_submitted_once` /
  `already_submitted_in_window`) and HTTP 401 when authentication is
  required but missing (`reason: authentication_required`). The
  client-side flags continue to work for UX; this is the bypass-proof
  backstop.
- `SurveyRunRepository::findLatestCompletedForUser(Survey, userId,
  windowStart?, windowEnd?)` powers the new guard and is reusable from
  any caller that needs to know whether a user already completed a
  run.

### Added

- Local runtime dev server (`npm --prefix frontend run dev:runtime`) for
  live-reloading SurveyJS plugin UI through the host runtime without
  rebuilding/reinstalling the plugin after every frontend change.
- Survey drafts are now stored separately from published versions, with
  conflict-safe save/publish APIs, restore-version support, and
  collaborative editing presence events.

### Changed

- Survey creation now asks only for a name. The backend generates the
  stable survey ID automatically; admins can rename and retheme the
  survey later from Settings.
- SurveyJS admin is organized around a selected survey workspace so
  Designer, Responses, Dashboard, and Settings always keep survey
  context visible.

### Fixed

- Survey submissions now keep answer values in the plugin response
  metadata while still writing the same values into the CMS data table,
  so the Responses/Dashboard views and the CMS data browser show the
  submitted data.
- `scripts/build-shplugin.mjs` now writes archive-root-relative paths
  in `artifacts/SHA256SUMS` (`<hash>  artifacts/<file>`). The host's
  `PluginArchiveValidator` rejects unprefixed paths as a
  zip-slip / signed-payload-smuggling defence, so the previous
  layout produced "SHA256SUMS entry must be archive-root-relative
  and live under artifacts/" install errors.
- `scripts/build-shplugin.mjs` now feeds `sha256-`-prefixed digests
  into `sign.mjs build-payload` (matches the SRI /
  `PluginArchiveValidator::normaliseChecksum()` convention).
  Previously the canonical signed payload diverged from the host's
  recomputed payload by exactly that prefix, surfacing as
  "Canonical signed payload mismatch" once the SHA256SUMS layout
  was fixed.
- `selfValidate()` resolves SHA256SUMS lines from the staging root
  instead of the staging `artifacts/` dir so it matches the new
  prefixed layout.

### Changed

- Single cross-platform Node scripts replace the previous PowerShell
  / Bash duplicates:
  - `scripts/install-local.{ps1,sh}` → `scripts/install-local.mjs`.
  - `scripts/publish-to-registry.{ps1,sh}` → `scripts/publish-to-registry.mjs`.
  Same command on PowerShell, Git Bash, WSL, macOS, and Linux —
  no more "wrong shell" syntax errors.
- `.github/workflows/publish-to-registry.yml` calls
  `node scripts/publish-to-registry.mjs` instead of `bash`.

### Added

- `.env.example` documents every env variable the build / install /
  publish scripts read (signing keys, admin token, host base URL,
  backend path, registry path). Every script auto-loads
  `<plugin>/.env` via Node 22's `process.loadEnvFile`, so plugin
  authors can keep their local dev keypair next to `plugin.json`
  instead of exporting it in every shell. Real `process.env`
  values still override `.env`, which keeps CI secrets dominant.

- `plugin.json` `compatibility.selfhelp` bumped from `^2.0` to
  `>=8.0.0-dev <9.0.0` so the install policy accepts the current
  SelfHelp host (which reports `8.0.0-dev`).

### Docs

- `README.md`, `docs/install.md`, `docs/publish.md`, `docs/secrets-setup.md`
  and `AGENTS.md` updated to reflect the `.mjs`-only script layout,
  the `.env` workflow, and the SHA256SUMS prefix fix. Every
  reference to `install-local.{ps1,sh}` / `publish-to-registry.{ps1,sh}`
  has been replaced with the canonical `node scripts/<name>.mjs`
  invocation.

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
- Public + admin API routes under `/cms-api/v1/admin/plugins/sh2-shp-survey-js/*` and `/cms-api/v1/plugins/sh2-shp-survey-js/*`.
- Frontend npm package contributing the `surveyjs` runtime style + `gpxMap` standalone style.
- Mantine theme bridge for both the SurveyJS Creator and the runtime renderer.
- Tiptap-based rich-text question + Creator property editors via the host `IRichTextEditorAdapter`.
- Optional GPX (Leaflet) and Video question types behind feature flags.
- Readonly mobile package with an "Open on web" fallback for unsupported question types.
- Mercure-driven realtime topics: `surveys/{surveyId}/editing` for collaborative editing and `surveys/{surveyId}/responses` for live response streams.
- Health-check endpoint + service id `humdek.surveyjs.health_check`.
- Admin-only license-key endpoint (env var `SURVEYJS_LICENSE_KEY`).

# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).

## 0.2.6 — 2026-05-26

### Changed

- **Plugin API routes are now host-persisted, not event-registered.**
  The host (`sh-selfhelp_backend` ≥ pre-release) replaced the event-
  based `ApiRouteRegistryEvent` with a database-backed pipeline: the
  installer's `PluginApiRouteSynchronizer` reads `plugin.json#apiRoutes`
  and writes one row per route into `api_routes` (tagged with
  `id_plugins`), linked to permissions via `rel_api_routes_permissions`.
  `ApiRouteLoader` then loads plugin routes through the same
  DB-backed pipeline used for core routes and filters out rows whose
  owning plugin is disabled. To match the new contract:

  - `plugin.json#apiRoutes` now declares `controller`
    (`Humdek\SurveyJsBundle\Controller\Api\V1\…::method`) and
    `requirements` (regex per path placeholder) for every route, so
    the host can validate the manifest, resolve permissions, and
    build the `api_routes` row up-front.
  - `backend/src/EventSubscriber/SurveyJsApiRouteSubscriber.php`
    and its `App\Plugin\Event\ApiRouteRegistryEvent` stub were
    removed — the manifest is now the only source of truth.
  - The plugin's migration still seeds the eight
    `surveyjs.surveys.*` permissions and links them to the `admin`
    role so administrators get full access out of the box.
  - The vendored `docs/plugins/plugin-manifest.schema.json` was
    refreshed to the host's canonical copy (which now requires
    `controller` on every `apiRoutes` entry and accepts optional
    `version` / `requirements` / `params` / `permission` /
    `permissions`).

  No DB schema change — this is a code-level change only (patch
  bump per the host's plugin version semantics).

## 0.2.5 — 2026-05-26

### Fixed

- **Admin Surveys page now loads.** Browser-side API clients were
  hitting the Symfony route prefix (`/cms-api/v1/...`) directly,
  which 404'd against the Next.js dev server because the host
  frontend funnels every API call through its BFF proxy at
  `/api/[...path]`. The plugin now uses the BFF-relative form
  (`/api/admin/plugins/sh2-shp-survey-js/...` and
  `/api/plugins/sh2-shp-survey-js/...`); the proxy validates CSRF,
  attaches the httpOnly JWT, and forwards to
  `/cms-api/v1/...` on the Symfony backend. Affected files:
  `frontend/src/api/surveys-admin.ts`, `frontend/src/api/surveys.ts`,
  `frontend/src/index.ts` (license-key health check),
  `frontend/src/admin/SurveyResponsesPage.tsx` (PDF download link),
  and the `select-survey-js` field renderer comment.

### Changed

- **Migrations consolidated into a single install file.** The plugin
  is still pre-release, so the schema + CMS surface registration that
  used to be split across `Version20260522063620`,
  `Version20260525200000`, and `Version20260525200500` now lives in a
  single `Version20260522063620.php`. Fresh installs (and
  `selfhelp:plugin:install` followed by enable) run one migration
  that creates the six plugin-owned tables (`surveys`,
  `survey_versions`, `survey_runs` with `visitor_id`,
  `survey_answer_links`, `survey_response_drafts`, `survey_files`),
  seeds the full field set (including `timeout`,
  `dynamic_replacement`, `own_entries_only`, `data_config`,
  `allow_anonymous`, `sample_points`), and registers all eight
  permissions (`surveyjs.surveys.{manage, view-responses, export-pdf,
  delete-responses, export-csv, export-xlsx, export-json,
  upload-files}`).

### Upgrading from 0.2.x

This release REPLACES the migration set. Reinstall the plugin
locally to apply the unified migration:

```bash
node scripts/install-local.mjs --symlink
```

The install script purges the previous install (which drops the
plugin-owned tables thanks to `id_plugins` tagging) before
re-running the consolidated migration.

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
  `SignedFileUrlService`, `SurveyDataInterpolator`,
  `VisitorIdResolver`, and `SurveyResponseService` edit-mode submit
  path (`SurveyResponseServiceEditModeTest`). Frontend Vitest
  scaffolding under `frontend/tests/` covers `markdown`,
  `LocalDraftStore`, `CountdownTimer`, and `extractUrlParams`.
- QA scenarios catalogue at `docs/qa-scenarios.md` documenting every
  legacy-parity behaviour we expect operators to validate against.

### Fixed

- Export endpoints now enforce per-format permissions. The single
  `/admin/surveys/{id}/responses/export?format=...` route used to
  resolve to one permission entry in `plugin.json`, so the
  `export-csv` / `export-xlsx` / `export-json` permissions seeded by
  `Version20260525200000` were never actually checked. The route is
  now split into three real endpoints (`.../export/csv`,
  `.../export/xlsx`, `.../export/json`) — each declared in both
  `SurveyJsApiRouteSubscriber` and `plugin.json` with its specific
  permission — and `buildResponsesExportUrl()` builds the matching
  URLs. The runtime export menu calls the format-specific URLs;
  scheduled callers must update any hard-coded `?format=...` URLs.
- File upload (`POST /surveys/{surveyId}/files`) now enforces
  ownership of the supplied `responseId`. Anonymous callers must hold
  the matching `_sh_sjs_vid` visitor cookie for the draft/run they
  are uploading into; authenticated callers must own the draft/run
  (or hold `surveyjs.surveys.view-responses`). This closes the gap
  where the seeded `surveyjs.surveys.upload-files` permission could
  not be enforced as a static route permission because the endpoint
  must remain reachable for anonymous respondents.
- Edit-mode submit (`enforce.editMode === true`) now updates the
  existing `survey_runs` row in place instead of creating a second
  run with a fresh `response_id`. The corresponding `data_rows` row
  is rewritten through `DataService::saveData(..., ['id' => $row])`,
  the previous `survey_answer_links` are replaced atomically, and
  `completed_at` is preserved. Edit attempts against runs owned by
  another user/visitor are rejected with HTTP 403; missing
  `responseId` or unknown ids return HTTP 404.
- Frontend API clients (`frontend/src/api/surveys.ts`,
  `frontend/src/api/surveys-admin.ts`, the runtime license-key health
  check in `frontend/src/index.ts`, the responses-page PDF link and
  the survey-select field renderer) now call the real backend
  prefixes `/cms-api/v1/plugins/...` and
  `/cms-api/v1/admin/plugins/...`. The previous `/api/plugins/...`
  and `/api/admin/plugins/...` paths were leftovers from a different
  host conventions and 404'd against the route table registered by
  `SurveyJsApiRouteSubscriber`.
- `markdown.ts` now renders inline backtick code as `<code>...</code>`
  with HTML-escaped content. The implementation previously left
  backticks as literal characters even though `markdown.test.ts`
  expected the inline-code rendering, so the suite was red.

### Tests / coverage status

Phase 6 of the parity plan is **in progress**, not completed. The
new tests added in this changeset cover the critical fixes above
(edit-mode submit happy + reject paths) but the full Phase 6
checklist still has open items:

- `SurveyResponseServiceTest` — once-per-user, per-schedule,
  anonymous + visitor cookie, draft promotion (only the edit-mode
  subset ships today).
- `SurveyResponseDraftServiceTest`, `SurveyFileStorageTest`,
  `SurveyExportServiceTest`.
- Symfony `WebTestCase` coverage for the public/admin API (upload,
  signed download, exports, edit mode, permission enforcement).
- Vitest coverage for `SurveyRuntime` lifecycle, custom question
  types and the dashboard renderer.
- Mobile read-only regression test.

These remain explicit follow-ups.

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

# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).


## [0.2.22] - 2026-06-12

### Changed
- Version bump to 0.2.22.

## [0.2.21] - 2026-06-12

### Changed
- **Open-ended core compatibility (ecosystem compatibility policy).**
  `plugin.json#compatibility.selfhelp` `>=0.1.0 <0.2.0` -> `>=0.1.0`. Plugins
  now declare an open-ended minimum on the core axis; `pluginApiVersion` is
  the breakage contract and the registry `blocked` flag / advisories handle
  retroactive breakage. This stops every future core minor (0.2.x, 0.3.x, ...)
  from being wrongly reported as incompatible by the backend update preflight
  and the manager update plan. Policy reference:
  `sh-selfhelp_backend/docs/developer/26-plugin-compatibility-rules.md`.
- Version `0.2.1` supersedes the registry's `0.2.0` entry (which pinned
  `>=0.2.0 <0.3.0` and could not install on 0.1.x hosts). Patch-only release:
  no DB change, no migration, no code change beyond the manifest + version
  mirrors and their contract tests.

### Changed
- **Ecosystem 0.1.0 version reconciliation.** Re-baselined this plugin to the
  pre-release `0.1.0` scheme shared by the whole SelfHelp ecosystem (nothing is
  officially released yet, so no backward compatibility is kept):
  - `plugin.json#version`, `backend.composer.version`, and `mobile.version`
    `0.2.20` -> `0.1.0`; `frontend/package.json`, `mobile/package.json`, and the
    `PLUGIN_VERSION` constants in `frontend/src/index.ts` + `mobile/src/index.ts`
    follow.
  - `plugin.json#pluginApiVersion` `1.1` -> `0.1.0` (the unified SDK version the
    `@selfhelp/shared` package now exports); the web (`1.1`) and mobile (`1.0`)
    runtime registrations both move to `0.1.0`.
  - `plugin.json#compatibility.selfhelp` `>=8.0.0-dev <9.0.0` -> `>=0.1.0 <0.2.0`
    (pre-1.0 SemVer: each minor is breaking, so the range tracks one core minor).
  - Contract tests realigned: the frontend manifest guardrail, the mobile parity
    snapshot, and the backend manifest certification now assert the `0.1.x`
    scheme.

### Added
- **Backend certification tests (ecosystem testing strategy, Slice 8C).**
  - `backend/tests/Service/SurveyResponseServiceTest.php` — unit coverage
    for the normal (non-edit) submission path: a finished submit creates a
    completed `SurveyRun`, writes one `SurveyAnswerLink` per normalized
    answer, records the data-table row id, publishes the realtime event,
    and enforces the once-per-user guard. Complements the existing
    edit-mode regression test.
  - `backend/tests/Service/SurveyDashboardServiceTest.php` — unit coverage
    for the dashboard summary + flattened results aggregations, including
    JSON answer decoding and the version/progress fallbacks.
  - `backend/tests/Certification/PluginManifestCertificationTest.php` —
    standalone certification that `plugin.json` declares a complete,
    self-consistent compatibility matrix + deny-by-default capability /
    trust-level contract (runs in plugin CI without the host checkout).
  - The runtime install-lifecycle certification lives in the host repo as
    `App\Tests\Certification\Plugin\SurveyJsPluginCertificationTest`, which
    runs this plugin's real manifest through the host's manifest,
    compatibility, and capability validators.
- **Frontend + mobile certification (ecosystem testing strategy, Slice 8D).**
  - `frontend/tests/e2e/creator.spec.ts` + `frontend/playwright.config.ts` —
    a release-tier Playwright golden that logs in as a manage-capable admin,
    opens the consolidated SurveyJS admin page, and reaches the Survey
    Creator (`.svc-creator` when a QA survey id is supplied). Self-skips
    when no QA stack env is configured, with login/list/creator perf budgets.
  - `mobile/__tests__/parity/registration.test.ts` +
    `mobile/vitest.config.ts` — the first mobile test: renderer-parity +
    registration snapshot for the read-only `surveyjs` style. Guards the
    "keep `PLUGIN_VERSION` in sync with `plugin.json`" footgun and the
    declared style/feature-flag contract.
  - CI: `validate-plugin.yml` now runs Vitest in the frontend and mobile
    jobs; new `plugin-certification.yml` runs the release-tier certification
    (backend PHPStan + PHPUnit, Playwright Creator E2E, mobile parity).

## 0.2.20 — 2026-05-28
 - update `@selfhelp/shared` to `v1.2.1`

## 0.2.19 — 2026-05-28

### Fixed
- **SurveyJS Creator still showed the "developer license required"
  watermark even when `SURVEYJS_LICENSE_KEY` was configured.** The
  Designer page used to pass the license string through the
  `licenseKey` SurveyCreator constructor option, which `survey-
  creator-core` 2.5.x silently ignores (the symbol is no longer in
  its source). The supported v2.x path is the global
  `setLicenseKey()` exported from `survey-core`, called BEFORE
  constructing the Creator. `SurveyDesignerPage` now dynamically
  imports `survey-core` and invokes `setLicenseKey(license.licenseKey)`
  whenever `fetchLicenseKey()` returns a non-null key, then
  constructs the Creator without the unsupported option. The
  watermark disappears as soon as a valid key is provided. The
  public survey runtime (`SurveyRuntime.tsx`) was already using
  this API path correctly for the SavePDF feature and was not
  affected by this bug.

- **"Developer live reload" admin panel was shown to all admins on
  the SurveyJS plugin page.** The panel documents the dev-server
  install workflow (`install-local.mjs --symlink` +
  `npm run dev:runtime`) and is only useful to plugin developers
  iterating locally. It now renders only when the plugin runtime
  was loaded from a cross-origin location relative to the host
  page (i.e. an external Vite dev server like
  `http://localhost:5174`). Regular installs from the registry,
  archives, or connected sources resolve their entry through the
  host's own `/plugin-artifacts/...` origin, so the panel stays
  hidden. The check lives in the new
  `frontend/src/runtime-mode.ts` module and uses
  `import.meta.url` so it stays correct across every dev
  live-reload cycle (each re-import gets a fresh URL) without
  requiring a new field on the `IPluginApi` SDK contract.

### Internal
- New small helper module `frontend/src/runtime-mode.ts` exporting
  `IS_DEV_RUNTIME` (computed once at module load). Used by
  `SurveyAdminPage` for now; available to any other admin/runtime
  module that needs the same signal in the future.


## 0.2.18 — 2026-05-28

### Fixed
- **Dev live reload re-imported the entry but the browser served stale
  inner modules — visible changes required a hard reload.** After
  0.2.16 hardened the SSE pipeline and the host's URL handling, the
  full chain (`watcher → SSE → host re-import → registerOne`) ran
  end-to-end on every edit, the plugin re-registered correctly,
  yet the rendered UI kept showing the previous code until the
  user pressed F5 / Ctrl-R.

  Root cause (traced against Vite 7's source): Vite tracks two
  separate timestamps on every module in its graph,
  `lastInvalidationTimestamp` (server-side transform-cache
  invalidation) and `lastHMRTimestamp` (set only when invalidation
  is triggered through the HMR path). Vite's import-analysis
  plugin gates the `?t=<ts>` cache-bust on child import URLs on
  `lastHMRTimestamp > 0`, not on `lastInvalidationTimestamp`. With
  `hmr: false` (which middleware mode forces because the host page
  doesn't run Vite's HMR client) Vite's own watcher → moduleGraph
  chain only updates `lastInvalidationTimestamp`. The result was:
  1. We broadcast SSE → host re-imports
     `plugin.esm.js?_shDevReload=<newToken>`.
  2. Vite re-transformed the entry because its URL changed.
  3. The entry's inner imports kept their previous Vite-generated
     URLs (e.g. `/src/admin/SurveyAdminPage.ts?import` with NO
     `?t=` query) because `lastHMRTimestamp` had never been bumped.
  4. The browser saw the same inner-module URLs and returned the
     cached transforms from before the edit.
  5. The "fresh" plugin module imported the OLD inner exports.
     React's diff saw the same component types as before, nothing
     remounted, and no visual change appeared.
  6. Hard reload bypassed the browser module cache and worked.

  `scripts/dev-runtime.mjs` now calls
  `viteServer.moduleGraph.invalidateModule(mod, seen, Date.now(), true)`
  — with `isHmr = true` — for every Vite module mapped to the
  changed file before broadcasting the SSE reload. That's exactly
  what stamps `lastHMRTimestamp`, so the next entry transform
  emits fresh `?t=<timestamp>` queries on every importer of the
  changed file. The browser refetches them, the host receives
  genuinely new function references, React sees a new component
  type, unmounts the old subtree, and mounts the new code without
  a hard reload.

  The fix also normalises Windows-style chokidar paths
  (`D:\...\Foo.tsx`) to forward slashes before the moduleGraph
  lookup, because Vite's `fileToModulesMap` is keyed by normalised
  paths and a raw-path lookup silently returned `undefined` on
  Windows — the cascade was triggering correctly on Linux/macOS
  but no-op'ing on Windows, so the symptom looked identical to
  the un-fixed version on Windows hosts. Both the
  invalidate-hit and the no-modules-found cases now log a single
  `[dev-runtime] HMR-invalidated N module(s) for <path>` or
  `[dev-runtime] WARNING: no Vite modules tracked for <path> …`
  line on dev-server stdout regardless of `SELFHELP_DEV_RUNTIME_DEBUG`,
  so a quick glance at the terminal confirms whether each edit
  reached the moduleGraph.

### Internal
- Bumped to v0.2.18 to unblock validation; no schema or behaviour
  change beyond the dev-only invalidation fix above.


## 0.2.16 — 2026-05-28

### Fixed
- **Dev runtime live reload silently no-op'd after the first transform.**
  The 0.2.14 / 0.2.15 fixes restored singleton identity between the
  dev bundle and the host, but on top of that, Vite 7's middleware
  mode chokidar watcher only registers the files Vite has already
  added to its module graph through prior transforms. After the
  browser loaded `plugin.esm.js`, the entry file plus its direct
  imports WERE tracked, but the watcher could silently skip emitting
  the `change` event to user listeners attached on
  `viteServer.watcher` in some edit cycles — particularly when an
  editor saves via atomic-replace (which chokidar surfaces as
  `unlink` + `add` rather than `change`). The dev runtime now:
  - explicitly tells chokidar to watch `frontend/src/` from boot, so
    the very first edit fires an event regardless of which Vite
    transforms have already happened,
  - listens for `add` / `change` / `unlink` (not just `change`),
  - skips events that originate outside the plugin tree (e.g. files
    chokidar surfaces inside `node_modules/.vite/deps/`),
  - applies a 1.5 s startup grace window so the chokidar catch-up
    scan triggered by the explicit `.add(srcDir)` call cannot
    broadcast a spurious reload to an EventSource that connects in
    those first few ms.
- **EventSource reload stream could be silently buffered.** The
  `/__selfhelp_plugin_reload` SSE response now sends a 2 KB padding
  byte burst and `retry: 1000` directive immediately on connect,
  flushes a `: ping\n\n` keep-alive every 25 s, and sets
  `X-Accel-Buffering: no`. This guarantees `EventSource.readyState`
  reaches `OPEN` and that idle connections cannot be torn down by
  upstream proxies / Windows TCP keep-alive policies during long
  edit-free intervals.

### Added
- **`scripts/dev-runtime.mjs` is now self-diagnosing.**
  - Every SSE client connect / disconnect is logged unconditionally,
    including the `Origin` header, so it is obvious from the
    terminal whether the host EventSource actually reached the dev
    runtime.
  - Every reload broadcast prints
    `[dev-runtime] reload broadcast → N client(s) (M connected)`
    so you can see at a glance whether an edit produced an SSE
    fan-out (and whether the browser was attached at the moment).
  - Setting `SELFHELP_DEV_RUNTIME_DEBUG=1` (or passing `--debug`)
    additionally logs every watcher event with its file path and
    every filter decision (`suppressed (within startup grace
    window)`, `ignored: path outside …`, `client write failed: …`),
    making it straightforward to localise a stuck reload chain
    without rebuilding the host.

### Changed
- Bumped `plugin.json#version`, `backend.composer.version`,
  `mobile.version`, `frontend/package.json#version`, and
  `frontend/src/index.ts#PLUGIN_VERSION` from `0.2.15` to `0.2.16`.

## 0.2.15 — 2026-05-28

### Fixed
- **`npm --prefix frontend run dev:runtime` crashed on startup with**
  `X [ERROR] The entry point "react" cannot be marked as external` /
  `X [ERROR] The entry point "react-dom" cannot be marked as external`.
  The 0.2.14 `vite.config.ts` set
  `optimizeDeps.exclude = [...PLUGIN_RUNTIME_SHIM_SPECIFIERS]` as a
  cold-start optimisation, but Vite's dep scanner already adds
  `react`/`react-dom` to esbuild's entry-points list when it walks
  `src/index.ts`. `exclude` then also adds them to esbuild's
  `external` list, and esbuild refuses to be told to bundle and
  externalize the same id, which aborts the dev server. The fix is
  to drop `optimizeDeps.exclude`: the shim plugin's `enforce: 'pre'`
  `resolveId` hook still intercepts every shimmed specifier BEFORE
  Vite's pre-bundled-dep redirect runs, so the pre-bundle sitting
  in `node_modules/.vite/deps/` is never actually loaded by the dev
  bundle. Production build path is unchanged.
- **Runtime self-reported version was stale.**
  `src/index.ts`'s `PLUGIN_VERSION` constant (passed to
  `definePlugin({ version })`) still read `'0.2.13'` after the 0.2.14
  manifest bump. The host's `PluginRuntime.registerOne()` refuses to
  apply a registration whose `version` mismatches the manifest entry,
  so once the dev server actually started serving the bundle the
  plugin would have been silently dropped with a
  `registrationMismatch` warning. The constant is now bumped to
  `'0.2.15'` alongside `plugin.json`, `backend.composer.version`,
  `mobile.version`, and `frontend/package.json#version`.

## 0.2.14 — 2026-05-28

### Fixed
- **Dev runtime live reload broke after the first edit cycle.** When
  `npm --prefix frontend run dev:runtime` served the plugin through
  Vite middleware mode, the `selfhelp-runtime-shim` Vite plugin was
  gated to `command === 'build'` and therefore never ran in dev.
  Vite's default resolver then pointed bare specifiers (`react`,
  `@mantine/core`, `@tanstack/react-query`, …) at the plugin's own
  `node_modules`, so the dev bundle ran against a SECOND React copy
  and the host's hooks could not see the plugin's components after
  the SSE reload re-imported the entrypoint. The shim plugin now
  runs in BOTH build and dev: in dev it inlines the host's shim
  payload, so the dev bundle reads from the host's
  `globalThis.__SELFHELP_RUNTIME__` and shares singletons with the
  host shell just like the production build does. Live reload now
  works end-to-end through the SSE stream + cache-busted re-import.

### Changed
- The plugin's `frontend/vite.config.ts` and `scripts/dev-runtime.mjs`
  now read the canonical singleton list, the host import map, and
  the runtime-shim base path from `@selfhelp/shared/plugin-sdk`
  (`PLUGIN_RUNTIME_SHIM_SPECIFIERS`, `PLUGIN_RUNTIME_IMPORT_MAP`,
  `PLUGIN_RUNTIME_SHIM_BASE_PATH`). The previous hand-maintained
  arrays/maps duplicated the host's list and drifted whenever the
  host added a new singleton. Removing the duplication fixes the
  long-standing problem where `react/jsx-dev-runtime` and other
  dev-only specifiers were missing from the externalisation set.
- Bumped `@selfhelp/shared` peer/dev dep from `^1.1.0` to `^1.2.0`
  for the new runtime-shim contract export.
- `frontend/package.json` version + `plugin.json#version` +
  `plugin.json#backend.composer.version` +
  `plugin.json#mobile.version` bumped to `0.2.14` (patch — pure
  build + dev fix, no schema change, no migration).

## 0.2.13 — 2026-05-27
 - new build

## 0.2.12 — 2026-05-27
 - build `standalone` and `connected` versions

## 0.2.11 — 2026-05-27
 - new build strucutre

## 0.2.10 — 2026-05-27
 - add proper installation `mode`

## 0.2.9 — 2026-05-27
 - change signed files

## 0.2.8 — 2026-05-27
 -  adjust the installation build

## 0.2.7 — 2026-05-27

### Added

- **Inline survey rename**. The surveys list now exposes a pencil
  icon next to each name plus a **right-click → Rename** context menu;
  the Designer header lets you double-click the title (or click the
  pencil icon) to rename without leaving the editor. Press `Enter` to
  save and `Esc` to cancel. The Settings tab still works for renames
  too — the inline shortcuts are an additive, friendlier path.
- **Designer change detection + change counter**. The Designer header
  now compares the live Creator JSON against the last published
  revision after every Creator mutation and shows an orange
  "N unpublished changes" badge with a structural change count. The
  **Publish** button:
  - is rendered in the warning (`orange`) color so it never looks like
    a passive secondary action,
  - is **disabled when there are no changes** (preventing redundant
    revisions with identical SHA-256), and
  - displays the change count inline (`Publish (3)`) so the admin
    knows exactly how big the publish will be.
- **Versions tab — side-by-side comparison**. The Versions tab now
  carries a checkbox per row to pick a base + target version and a
  **Compare selected** action that opens a structural diff modal.
  Diffs categorise changes as `added` / `removed` / `modified` /
  `moved` / `setting`, with old/new value snapshots for settings.
  Both the Designer badge and the comparison modal share the new
  `definitionDiff.ts` engine so semantics stay consistent across the
  UI.
- **Restore guidance**. The restore confirmation dialog now spells
  out that restore is non-destructive (creates a new revision, leaves
  historical responses attached to their original revision) so
  operators understand what they are committing to.
- **Single-version API endpoint**. `GET /admin/.../surveys/{id}/versions/{versionId}`
  returns one version with its full definition. Used by the
  comparison modal to fetch two definitions on demand without
  inflating the list response.

### Fixed

- **Designer required a full page reload to switch surveys.** When
  navigating between two surveys via `?id=` URL changes, the Designer
  state (creator instance, draft cache, change count) carried over
  from the previous survey, leaving the editor frozen on the wrong
  JSON. The page now resets all state on `surveyId` change and rebuilds
  the Creator on the new survey's draft.
- **Plugin runtime import map was rendered inside React's tree.**
  React 19 logged a dev-only warning ("Encountered a script tag while
  rendering React component") and could strip the script during
  client-side navigation, leaving subsequent plugin imports unable to
  resolve bare specifiers like `@selfhelp/shared/plugin-sdk`. The host
  layout now streams the import map through `useServerInsertedHTML`
  (new `PluginImportMapInjector` client component) so the browser
  parses it before any module script runs and React's reconciler
  never touches it. *(Host frontend change — sh-selfhelp_frontend.)*

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

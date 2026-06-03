# sh2-shp-survey-js — Architecture

Audience: Developers and technical operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-06-03.
Source of truth: Runtime code, configuration, and tests in this repository.

This document describes the moving parts of the SurveyJS v2 plugin and how they connect to the SelfHelp host. The plugin is split into three packages: a Symfony bundle (`backend/`), a React/Mantine npm package (`frontend/`), and a read-only React Native package (`mobile/`).

## High-level layout

```
┌────────────────────────────────────────────────────────────────┐
│  SurveyJS plugin (sh2-shp-survey-js)                           │
│                                                                │
│  ┌──────────────┐    ┌────────────────┐    ┌────────────────┐  │
│  │  backend/    │    │  frontend/     │    │  mobile/       │  │
│  │  Symfony     │    │  Next.js side  │    │  Expo / RN     │  │
│  │  bundle      │    │  (Mantine)     │    │  readonly      │  │
│  └──────┬───────┘    └────────┬───────┘    └────────┬───────┘  │
│         │                     │                     │          │
│         │ Doctrine entities   │ definePlugin()      │ defineMo…│
│         │ services            │ → SurveyJS Style    │ →readonly│
│         │ event subscribers   │ → Survey Designer   │   style  │
│         │ migrations          │ → Dashboard         │          │
│         │                     │ → Realtime topics   │          │
│         └─────────┬───────────┴────────┬────────────┘          │
│                   ▼                    ▼                       │
│           Manifest (plugin.json) — single source of truth      │
└────────────────────────────────────────────────────────────────┘
```

## Backend bundle

The bundle exposes a single `HumdekSurveyJsBundle` class registered dynamically by the host's `config/selfhelp_plugin_bundles.php`. The host installer regenerates that file when the plugin is installed / enabled / disabled. The bundle does not need to know how it is registered; it just provides:

| Component                                | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `Entity\Survey`                          | Aggregate root (key slug, theme, current version pointer).           |
| `Entity\SurveyVersion`                   | Immutable JSON definition snapshots.                                 |
| `Entity\SurveyRun`                       | Per-submission metadata, including the FK into core `data_rows`.    |
| `Entity\SurveyAnswerLink`                | Per-answer FK into core `data_cells` (one row per question).        |
| `Service\SurveyService`                  | CRUD + publish flow with `EM::wrapInTransaction()`.                  |
| `Service\SurveyAnswerNormalizer`         | Flattens SurveyJS JSON into cell-ready records.                      |
| `Service\SurveyJsHtmlSanitizer`          | Whitelist-based HTML sanitization for rich-text answers.             |
| `Service\SurveyResponseService`          | Public submit pipeline. Writes `data_rows` via `DataTableWriterInterface`. |
| `Service\SurveyDashboardService`         | Cheap aggregates for the dashboard.                                  |
| `Service\SurveyJsGdprService`            | Export + delete-for-user implementations.                            |
| `Service\SurveyJsHealthCheck`            | Health report consumed by the host doctor command.                   |
| `Service\SurveyJsRealtimePublisher`      | Wraps the host's `App\Plugin\Realtime\PluginRealtimePublisherInterface`. |
| `EventSubscriber\StyleRegistrySubscriber`| Contributes `surveyjs` + `gpxMap` styles to the admin catalog.       |
| `EventSubscriber\LookupRegistrySubscriber`| Declares `surveyJsTheme` as `plugin_owned`.                          |
| `EventSubscriber\RealtimeTopicSubscriber`| Registers the realtime topic catalog for JWT scoping.                |

The migration `Version20260522063620.php` creates the four plugin tables, seeds the three permissions, and seeds the `surveyJsTheme` lookup rows. `surveys.survey_id` and `survey_runs.response_id` are generated stable external keys; shared CMS rows and generated core `data_tables` are still tagged with `id_plugins` so the host purger can delete them by plugin ownership. `down()` is safe (drops only plugin-owned objects).

### Decoupling from the host

The bundle depends on host contracts, not concrete host services:

- `App\Plugin\Realtime\PluginRealtimePublisherInterface` — imported directly from the host. The CMS aliases this to its concrete `App\Plugin\Realtime\PluginRealtimePublisher` in `config/services.yaml`. The bundle ships **no** plugin-local null fallback; the host realtime layer must be present for the bundle to boot.
- `Service\DataTableWriterInterface` (implemented by the plugin's `CoreDataTableWriter`, which writes into the host `data_tables` / `data_rows` / `data_cols` / `data_cells` tables using the declared `sh2_surveyjs_` data-table prefix).

## Frontend package

The npm package's entry point (`src/index.ts`) returns an `IPluginRegistration` from `definePlugin()`:

- **Styles**: `surveyjs` (runtime), `gpxMap` (standalone Leaflet map).
- **Admin pages**: list, designer, responses, dashboard, settings — all under `/admin/plugins-host/sh2-shp-survey-js/*`.
- **Menu items**: one entry under the host's `admin` section.
- **Feature flags**: `gpx`, `video`, `rich-text`, `pdf-export`, `dashboard`, `collab-editing`.
- **Realtime topics**: `surveys/{surveyId}/editing`, `surveys/{surveyId}/responses`.
- **Health checks**: license-key reachability.

SurveyJS modules (`survey-core`, `survey-react-ui`, `survey-creator-react`) are declared as `peerDependencies` and imported through dynamic `import()` inside the style/admin components, so the host shell only pays for them when the SurveyJS plugin is actively rendering something.

The Mantine theme bridge (`src/theme/mantineBridge.ts`) translates the host's Mantine palette to the CSS variables SurveyJS v2 reads from `Model.applyTheme()`. The Creator and the runtime both consume the same bridge so the visual identity stays consistent.

## Survey versioning workflow

A survey definition is the SurveyJS JSON describing pages, questions,
themes, and survey-level settings. The plugin keeps two parallel
copies of that JSON per survey row:

- **Draft** — `surveys.draft_definition` (nullable). Written by every
  Designer `Save draft` call. Hashed with SHA-256 into
  `draft_definition_sha256` so saves can detect concurrent edits
  (`expectedDraftHash` request body field) without a row lock.
- **Published versions** — immutable rows in `survey_versions`. The
  `surveys.id_current_survey_versions` pointer is the public truth
  source; the `surveyjs` style on every page renders that version.

### Publish

`SurveyService::publishVersion()` is transactional:

1. Compute `revision = max(survey_versions.revision) + 1`.
2. Insert a new `SurveyVersion` (SHA-256 captured at construction).
3. Update `surveys.id_current_survey_versions`.
4. Clear the draft + draft hash (the next edit starts fresh from the
   freshly-published JSON).
5. Publish a `version_published` event on
   `surveys/{surveyId}/editing` so other editors refresh.

### Restore

`SurveyService::restoreVersion()` is non-destructive: it copies the
target version's definition into a brand-new revision (revision =
`max + 1`) and points `id_current_survey_versions` at that new row.
Old responses still reference the revision they were collected
against, so historical data stays intact and re-runnable. The diff
between the restored revision and the previously current revision
shows up as the change set in the next admin **Versions** comparison.

### Change detection (Designer "N unpublished changes" badge)

`frontend/src/admin/definitionDiff.ts` implements a structural diff
between two SurveyJS definitions, used by:

- The Designer header to enable/disable the `Publish` button and
  render the change-count badge.
- The Versions tab to render the structural diff modal when the
  operator compares two revisions.

Comparison rules:

- Pages and questions are matched by `name` when present, otherwise
  by array position.
- A pure reorder reports one `moved` entry per element instead of
  flagging every neighbour as `modified`.
- Top-level survey settings (everything outside `pages`) are compared
  with a stable JSON hash and reported once with old/new snapshots.

The diff engine runs entirely client-side; the backend keeps the
SHA-256 as the durable "did anything change" signal for audit purposes.

### API endpoints

| Method | Path                                                   | Purpose                          |
|--------|--------------------------------------------------------|----------------------------------|
| `GET`  | `/admin/.../surveys/{id}/versions`                     | List version summaries.          |
| `GET`  | `/admin/.../surveys/{id}/versions/{versionId}`         | Single version with definition.  |
| `POST` | `/admin/.../surveys/{id}/versions`                     | Publish a new version.           |
| `POST` | `/admin/.../surveys/{id}/versions/{versionId}/restore` | Restore as a new revision.       |
| `PUT`  | `/admin/.../surveys/{id}/draft`                        | Save a draft (with optimistic lock). |

The single-version GET endpoint is used by the Versions comparison
modal to load two definitions on demand without inflating the list
response. A future enhancement (response count per revision) belongs
on the list endpoint, since it would be expensive to compute every
time the comparison modal opens.

## Mobile package (v1 readonly)

The mobile package exports `registerMobile()` which contributes a read-only `surveyjs` style. It fetches the published JSON from the public endpoint, walks the question tree, and renders a static preview with a fall-back "Open on web" link. v1 does not support submissions; the host's `BasicStyle.tsx` routes anything that needs editing to `OpenOnWebFallback`. A native v2 powered by `survey-react-native` is on the roadmap.

## Realtime topics

Two topics scoped under `selfhelp/plugin/sh2-shp-survey-js/`:

- `surveys/{surveyId}/editing` — collaborative-edit presence + "version_published" notifications. Required permission: `surveyjs.surveys.manage`.
- `surveys/{surveyId}/responses` — new-response stream consumed by the dashboard. Required permission: `surveyjs.surveys.view-responses`.

No polling. The dashboard fetches an initial snapshot once and listens for SSE updates after that.

## Data flow on submission

1. The host frontend renders the `surveyjs` style for a public page.
2. The style fetches `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}` and renders the SurveyJS model.
3. On submit, the style POSTs to `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}/submit`.
4. `SurveysPublicController::submit()` calls `SurveyResponseService::submit()` which:
   - normalizes + sanitizes the answers (`SurveyAnswerNormalizer` + `SurveyJsHtmlSanitizer`),
   - opens a transaction,
   - creates a `SurveyRun`,
   - hands the normalized cell list to `DataTableWriterInterface::writeRow()` (`CoreDataTableWriter` persists a plugin-owned host data table named `sh2_surveyjs_<survey_id>`),
   - creates one `SurveyAnswerLink` per cell with the returned `id_data_cell`,
   - publishes `surveys/{surveyId}/responses` on Mercure,
   - commits.
5. The dashboard receives the SSE event and prepends the new run to its list — no polling, no manual refresh.

## File layout

```
sh2-shp-survey-js/
├── plugin.json
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── docs/architecture.md  (this file)
├── .github/workflows/validate-plugin.yml
├── backend/
│   ├── composer.json
│   ├── src/HumdekSurveyJsBundle.php
│   ├── src/Entity/{Survey, SurveyVersion, SurveyRun, SurveyAnswerLink}.php
│   ├── src/Repository/{Survey…, SurveyVersion…, SurveyRun…, SurveyAnswerLink…}Repository.php
│   ├── src/Service/{SurveyService, SurveyResponseService, SurveyDashboardService,
│   │                SurveyAnswerNormalizer, SurveyJsHtmlSanitizer, SurveyJsRealtimePublisher,
│   │                SurveyJsGdprService, SurveyJsHealthCheck,
│   │                CoreDataTableWriter, DataTableWriterInterface,
│   │                NullDataTableWriter, DataTableWriteResult}.php
│   ├── src/Controller/Api/V1/{SurveysAdmin, SurveysPublic, SurveysLicense, SurveysHealth}Controller.php
│   ├── src/EventSubscriber/{SurveyJsStyleRegistry, SurveyJsLookupRegistry, SurveyJsRealtimeTopic}Subscriber.php
│   ├── src/Resources/config/services.php
│   └── src/Migrations/Version20260522063620.php
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/{index.ts, external.d.ts,
│            api/{surveys, surveys-admin}.ts,
│            styles/{SurveyJsStyle, GpxMapStyle}.tsx,
│            admin/{SurveyAdminPage, SurveyDesignerPage, SurveyResponsesPage,
│                   SurveyDashboardPage, SurveySettingsPage,
│                   SurveyVersionsPage, definitionDiff}.tsx,
│            custom-questions/register.ts,
│            theme/mantineBridge.ts}
└── mobile/
    ├── package.json
    ├── tsconfig.json
    └── src/{index.ts, styles/SurveyJsReadOnlyStyle.tsx}
```

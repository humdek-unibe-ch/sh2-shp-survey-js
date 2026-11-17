# sh2-shp-survey-js — Architecture

Audience: Developers and technical operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-11-16 (theming section; the rest 2026-06-29).
Source of truth: Runtime code, configuration, and tests in this repository.

This document describes the moving parts of the SurveyJS v3 plugin and how they connect to the SelfHelp host. The plugin is split into three packages: a Symfony bundle (`backend/`), a React/Mantine npm package (`frontend/`), and a read-only React Native package (`mobile/`).

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
| `Entity\SurveyFile`                      | A file uploaded to a response (by `response_id`).                    |
| `Service\SurveyService`                  | CRUD + publish flow with `EM::wrapInTransaction()`.                  |
| `Service\SurveyAnswerNormalizer`         | One cell per question; a complex answer stays whole (JSON).          |
| `Service\SurveyJsHtmlSanitizer`          | Whitelist-based HTML sanitization for rich-text answers.             |
| `Service\SurveyResponseStore`            | The one home of responses: rows of the core data table `sh2_surveyjs_<survey id>`, written through `DataService::saveData()`, read through `DataQueryEngine`. |
| `Service\SurveyResponseService`          | Submit: limits, then the response saved as `finished`.               |
| `Service\SurveyResponseDraftService`     | Progress: the same row saved as `started` / `updated`, resume, discard. |
| `Service\SurveyDashboardService`         | Totals and chart rows for the dashboard, read from the store.        |
| `EventSubscriber\SurveyJsUserDataCleanupSubscriber` | Deletes a removed user's uploaded files (core `UserDataCleanupEvent`). |
| `Service\SurveyJsHealthCheck`            | Health report consumed by the host doctor command.                   |
| `Service\SurveyJsRealtimePublisher`      | Wraps the host's `App\Plugin\Realtime\PluginRealtimePublisherInterface`. |
| `EventSubscriber\StyleRegistrySubscriber`| Contributes `surveyjs` + `gpxMap` styles to the admin catalog.       |
| `EventSubscriber\LookupRegistrySubscriber`| Declares `surveyJsTheme` as `plugin_owned`.                          |
| `EventSubscriber\RealtimeTopicSubscriber`| Registers the realtime topic catalog for JWT scoping.                |

The plugin owns three tables: `surveys`, `survey_versions` and `survey_files`. The install migration `Version20260522063620.php` creates them (and three older ones that `Version20261117132938.php` drops again: responses now live only in the core data store). `surveys.survey_id` and the `response_id` cell of each response are generated stable external keys; shared CMS rows and generated core `data_tables` are tagged with `id_plugins` so the host purger can delete them by plugin ownership. `down()` is safe (drops only plugin-owned objects).

### Decoupling from the host

The bundle depends on host contracts, not concrete host services:

- `App\Plugin\Realtime\PluginRealtimePublisherInterface` — imported directly from the host. The CMS aliases this to its concrete `App\Plugin\Realtime\PluginRealtimePublisher` in `config/services.yaml`. The bundle ships **no** plugin-local null fallback; the host realtime layer must be present for the bundle to boot.
- `App\Service\CMS\DataService` (write and delete, rule 2.4) and `App\Service\CMS\DataQuery\DataQueryEngine` (read, rule 2.7), used only by `SurveyResponseStore`. A response is therefore an ordinary data row: actions, audit, cache, history and user cleanup work with no plugin code.

## Frontend package

The npm package's entry point (`src/index.ts`) returns an `IPluginRegistration` from `definePlugin()`:

- **Styles**: `surveyjs` (runtime), `gpxMap` (standalone Leaflet map).
- **Admin pages**: list, designer, responses, dashboard, settings — all under `/admin/plugins-host/sh2-shp-survey-js/*`.
- **Menu items**: one entry under the host's `admin` section.
- **Feature flags**: `gpx`, `video`, `rich-text`, `pdf-export`, `dashboard`, `collab-editing`.
- **Realtime topics**: `surveys/{surveyId}/editing`, `surveys/{surveyId}/responses`.
- **Health checks**: license-key reachability.

SurveyJS modules (`survey-core`, `survey-react-ui`, `survey-creator-react`) are declared as `peerDependencies` and imported through dynamic `import()` inside the style/admin components, so the host shell only pays for them when the SurveyJS plugin is actively rendering something.

The look comes from one stylesheet, `src/theme/mantine-adapter.css`. SurveyJS 3 is styled through design tokens (CSS variables starting with `--sjs2-`), set on `.sjs-theme-overrides`, the class SurveyJS puts on the root of every survey and of the Creator. The adapter points those tokens at Mantine's variables (`--mantine-*`) and copies no value, so the site's primary colour, radius, font and light or dark mode restyle the survey, the Creator and the dashboard with no plugin code. No theme is applied in JavaScript. The few things tokens cannot express are targeted rules at the end of the file. `src/theme/surveyDefaults.ts` holds the one model default that belongs to the look: a question's error is shown under its field.

To work on the look, run `npm --prefix frontend run dev:theme` and open `http://localhost:5175`. The page shows every question type next to real Mantine controls and needs no SelfHelp host. URL parameters fix a state: `scheme=light|dark`, `primary=<mantine colour>`, `page=<number>`, `single=1`, `errors=1`, `view=creator`. `tests/mantineAdapter.test.ts` fails when a SurveyJS or Mantine update renames a variable the adapter uses.

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

- `surveys/{surveyId}/editing` — collaborative-edit presence + "version_published" notifications. Required permission: `surveyjs.survey.update`.
- `surveys/{surveyId}/responses` — new-response stream consumed by the dashboard. Required permission: `surveyjs.surveys.view-responses`.

No polling. The dashboard fetches an initial snapshot once and listens for SSE updates after that.

## Data flow on submission

1. The host frontend renders the `surveyjs` style for a public page.
2. The style fetches `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}?page_id=…&section_id=…` and renders the SurveyJS model. Every public call names the page and the section it is drawn on (the host passes `page` to plugin styles), with `language_id`, `preview` and `route[...]`. `SurveySectionResolver` lets the core check the caller may use that section (`PublicSectionAccessService`, H4) and reads every setting from the published section into `SurveySectionSettings`; nothing that limits a participant comes from the request. The survey's `{{variables}}` are filled with the section's variables (H1). The reply is never cached.
3. On submit, the style POSTs to `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}/submit` (same query); it sends only which response it is (response id, edit mode, page reached, language). The server applies login needed, open hours and once per user or window, the window in the participant's timezone.
4. `SurveysPublicController::submit()` calls `SurveyResponseService::submit()` which:
   - checks the once-per-user and schedule limits,
   - normalizes + sanitizes the answers (`SurveyAnswerNormalizer` + `SurveyJsHtmlSanitizer`),
   - saves the response through `SurveyResponseStore` as one row of the data table `sh2_surveyjs_<survey id>` with trigger `finished` (the participant's own unfinished row when they saved progress before),
   - publishes `surveys/{surveyId}/responses` on Mercure.
5. The dashboard receives the SSE event and reloads — no polling, no manual refresh.

### One row per response

| Moment | Row |
|--------|-----|
| First progress save (page change, autosave) | new row, trigger `started` |
| Later progress saves | same row, trigger `updated` (the page reached never goes back) |
| Submit | same row, trigger `finished`; progress sent later for it is ignored |
| Edit of a submitted response (`editMode`) | same row, stays `finished` |
| Discard, or delete by an admin | core soft delete, trigger `deleted` (history kept) |

Besides the answers each row carries reserved columns: `response_id`, `survey_revision`, `guest_key`, `language`, `page_no`. A question may not use these names, nor the core's row columns; publishing refuses them (HTTP `422`).

A signed-in participant owns their row (`id_users`). A guest's row has no owner; it carries the **guest key**, a random 128-bit id the browser keeps and sends as the `X-SurveyJs-Guest-Key` header (the host BFF drops cookies the backend sets, so the older `_sh_sjs_vid` cookie only works for clients that call the backend directly). A row keeps the guest key only when a guest wrote it, so the next person on a shared browser cannot match a signed-in participant's response. A guest who signs in keeps their unfinished response, and it becomes theirs when they save it.

Uploaded files are stored under `<form files dir>/surveyjs/` (`selfhelp.form_file_storage_dir`, a kept volume), unless `SURVEYJS_UPLOAD_DIR` says otherwise.

## Storage-key contract (host issue #56)

The host stores form/survey data by an **immutable `field_key`** (the column
identity in `data_cols`) separate from a **mutable `display_name`** (the human
label). SurveyJS maps onto that contract as follows:

- **`question.name` → `field_key`.** `SurveyAnswerNormalizer` emits each cell
  keyed by the question name; a matrix, multiple-text or dynamic-panel answer
  stays whole in one cell as JSON (splitting it into `question.row` columns gave
  keys the core refuses). The host treats that key as an **opaque immutable
  literal**. `SurveyResponseStore` passes those keys straight into
  `DataService::saveData()`, so old and new responses stay comparable across
  versions.
- **`question.title` → `display_name`.** The normalizer also emits the question
  **title** as the column label (`fieldLabels`), which `SurveyResponseStore`
  forwards to the host as the column `display_name`. Changing a title is
  therefore a **label-only** change — it never changes the storage key and never
  forks a column. The label is carried by the `$fieldLabels` parameter of
  `DataService::saveData()`, which the host added in **core `0.1.23`**. This is a
  **progressive enhancement, not a hard dependency**: on an older host the extra
  argument is ignored (PHP drops surplus positional args), so answers are still
  stored — only the column keeps its auto label instead of the question title.
  That is why `compatibility.selfhelp` stays `>=0.1.0` (the survey-storage
  contract works on any host; only the label enrichment needs `>=0.1.23`).
- **Renaming/removing an answered `question.name` is blocked at publish.**
  `SurveyService::publishDraft()` rejects publishing a new version (HTTP `409`
  via `SurveysAdminController::publishVersion()`) when the draft renames or
  removes a `question.name` that **already has stored responses** in a published
  version. The admin must instead rename the **title** (a safe display change) or
  add a **new** question with a new name. This is what keeps survey response data
  from fragmenting when authors edit a live survey.

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
│   ├── src/Entity/{Survey, SurveyVersion, SurveyFile}.php
│   ├── src/Repository/{Survey…, SurveyVersion…, SurveyFile…}Repository.php
│   ├── src/Service/{SurveyService, SurveyResponseStore, SurveyResponseRecord,
│   │                SurveyResponseService, SurveyResponseDraftService, SurveyDashboardService,
│   │                SurveyAnswerNormalizer, SurveyJsHtmlSanitizer, SurveyJsRealtimePublisher,
│   │                SurveyJsHealthCheck, SurveyFileStorage, SurveyPdfService, …}.php
│   ├── src/Controller/Api/V1/{SurveysAdmin, SurveysPublic, SurveysLicense, SurveysHealth}Controller.php
│   ├── src/EventSubscriber/{SurveyJsStyleRegistry, SurveyJsLookupRegistry, SurveyJsRealtimeTopic, SurveyJsUserDataCleanup}Subscriber.php
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
│            theme/{mantine-adapter.css, surveyDefaults.ts}}
└── mobile/
    ├── package.json
    ├── tsconfig.json
    └── src/{index.ts, styles/SurveyJsReadOnlyStyle.tsx}
```

# sh2-shp-survey-js — Architecture

Audience: Developers and technical operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-11-19 (admin screens, backend layout, file layout; theming 2026-11-16).
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
│         │ migrations          │ → Admin screens     │          │
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
| `Service\SurveyService`                  | CRUD + publish flow with `EM::wrapInTransaction()`.                  |
| `Service\SurveyAccessService`            | Grants on a survey (resource type `surveyjs_survey`) and on its data table; the rights the admin screens show per survey. |
| `Service\SurveySectionResolver`          | Public calls: the core checks page and section (H4), the settings are read from the published section. |
| `Service\SurveyAnswerNormalizer`         | One cell per question; a complex answer stays whole (JSON).          |
| `Service\SurveyJsHtmlSanitizer`          | Whitelist-based HTML sanitization for rich-text answers.             |
| `Service\SurveyResponseStore`            | The one home of responses: rows of the core data table `sh2_surveyjs_<survey id>`, written through `DataService::saveData()`, read through `DataQueryEngine`. |
| `Service\SurveyResponseService`          | Submit: limits, then the response saved as `finished`.               |
| `Service\SurveyResponseDraftService`     | Progress: the same row saved as `started` / `updated`, resume, discard. |
| `Service\SurveyDashboardService`         | Totals and chart rows for the Answers tab, read from the store.      |
| `Service\SurveyPdfService`               | One response as a PDF (dompdf when installed, else a printable page). |
| `Service\SurveyFileAnswers`               | File answers: keys stored without links, links added on load, keys of other responses dropped. |
| `Service\SurveyJsHealthCheck`            | Subchecks (database, licence key) in the host's plugin health report, tagged `selfhelp.plugin.health_check`. |
| `Service\SurveyJsRealtimePublisher`      | Wraps the host's `App\Plugin\Realtime\PluginRealtimePublisherInterface`. |
| `EventSubscriber\SurveyJsStyleRegistrySubscriber`| Contributes `surveyjs` + `gpx-map` styles to the admin catalog. |
| `EventSubscriber\SurveyJsLookupRegistrySubscriber`| Declares `surveyJsTheme` as `plugin_owned`.                   |
| `EventSubscriber\SurveyJsRealtimeTopicSubscriber`| Registers the realtime topic catalog for JWT scoping.          |
| `EventSubscriber\SurveyJsRealtimeGrantSubscriber`| Grants a user's event stream the survey topics they may follow. |
| `EventSubscriber\SurveyJsDataAccessResourcesSubscriber`| Lists the surveys on the core role screen (H6).          |
| `EventSubscriber\SurveyJsSectionBindingSubscriber`| Refuses placing a survey the editor has no view grant on (H7). |

The plugin owns two tables: `surveys` and `survey_versions`. The install migration `Version20260522063620.php` creates them (and four older ones that `Version20261117132938.php` drops again: responses and their uploads now live only in the core data store). `surveys.survey_id` and the `response_id` cell of each response are generated stable external keys; shared CMS rows and generated core `data_tables` are tagged with `id_plugins` so the host purger can delete them by plugin ownership. `down()` is safe (drops only plugin-owned objects).

### Decoupling from the host

The bundle depends on host contracts, not concrete host services:

- `App\Plugin\Realtime\PluginRealtimePublisherInterface` — imported directly from the host. The CMS aliases this to its concrete `App\Plugin\Realtime\PluginRealtimePublisher` in `config/services.yaml`. The bundle ships **no** plugin-local null fallback; the host realtime layer must be present for the bundle to boot.
- `App\Service\CMS\DataService` (write and delete, rule 2.4) and `App\Service\CMS\DataQuery\DataQueryEngine` (read, rule 2.7), used only by `SurveyResponseStore`. A response is therefore an ordinary data row: actions, audit, cache, history and user cleanup work with no plugin code.

## Frontend package

The npm package's entry point (`src/index.ts`) returns an `IPluginRegistration` from `definePlugin()`:

- **Styles**: `surveyjs` (runtime), `gpx-map` (route map from `sample_points`).
- **Admin page**: one page, `/admin/plugins-host/sh2-shp-survey-js/surveys`, opened with `surveyjs.survey.read` (see "Admin screens").
- **Menu items**: one entry under the host's `admin` section.
- **Feature flags**: `gpx`, `video`, `rich-text`, `pdf-export`, `dashboard`, `collab-editing`.
- **Realtime topics**: `surveys/{surveyId}/editing`, `surveys/{surveyId}/responses`.
- **Health checks**: database and licence key, in the host's plugin health report.

SurveyJS modules (`survey-core`, `survey-react-ui`, `survey-creator-react`) are declared as `peerDependencies` and imported through dynamic `import()` inside the style/admin components, so the host shell only pays for them when the SurveyJS plugin is actively rendering something.

The look comes from one stylesheet, `src/theme/mantine-adapter.css`. SurveyJS 3 is styled through design tokens (CSS variables starting with `--sjs2-`), set on `.sjs-theme-overrides`, the class SurveyJS puts on the root of every survey and of the Creator. The adapter points those tokens at Mantine's variables (`--mantine-*`) and copies no value, so the site's primary colour, radius, font and light or dark mode restyle the survey, the Creator and the dashboard with no plugin code. No theme is applied in JavaScript. The few things tokens cannot express are targeted rules at the end of the file. `src/theme/surveyDefaults.ts` holds the one model default that belongs to the look: a question's error is shown under its field.

### Admin screens

The host gives a plugin page one path segment, so `SurveyAdminPage` keeps its place in the query string (`admin/adminUrl.ts`): no `id` is the survey list, `?id=<id>&view=design|answers|versions|settings` is one survey's tab. Opening a survey and going back are history entries (browser back and forward work); a tab change replaces the entry. Links from before wave 8 (`view=designer|dashboard|responses`) land on the matching tab.

| Screen | File | What it does |
| --- | --- | --- |
| Survey list | `SurveyListPage.tsx` | Search, state filter (active, archived, all), table with answer count (links to the core Data screen), row actions view, edit, duplicate, archive, delete |
| Design | `SurveyDesignerPage.tsx` | The SurveyJS Creator, built once per survey: saving or publishing does not rebuild it. Read-only without the update right. A save names the draft it started from; a 409 offers "load the saved version" or "overwrite". Warns before leaving the page with unsaved changes |
| Answers | `SurveyAnswersPage.tsx` | Counts, charts (`survey-analytics`, drawn with Chart.js), and one response drawn as the survey (`SurveyResponseView.tsx`) with its PDF. Needs the grant on the survey's data table |
| Versions | `SurveyVersionsPage.tsx` | Version history, structural compare; restore only with the publish right |
| Settings | `SurveySettingsPage.tsx` | Name and survey ID |

The plugin lists no responses and exports nothing: that is the core Data screen (`/admin/data?tableIds=<data table id>`), linked from the list and the survey header.

**Rights in the screen.** A plugin cannot read the user's permissions, so the list and detail replies carry them: `canCreate` on the list, and per survey `rights: {update, publish, delete}` and `dataTableId` (null before the first response or without the grant on the table). `SurveyAccessService::rightsFor()` reads the caller's permissions (`UserPermissionService`) and their grants in one query, without an audit row per check; an action needs its route permission and the matching grant bit (publishing: the update grant). The screen only hides what will be refused; every call is still checked on the server.

**Look.** A plugin may import only `@selfhelp/shared/plugin-sdk` from the host, not its components. `admin/ui/AdminUi.tsx` and `admin/ui/admin-ui.css` rebuild the host's `PageHeader`, `ModalWrapper`, `EmptyState` and admin table with the same Mantine props; keep them in step with the host.

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

`SurveyService::restoreVersion()` points `id_current_survey_versions`
back at the chosen version and resets the draft to its definition; it
creates no new revision and deletes nothing, so the version list keeps
its order and the next publish gets `max + 1`. Responses keep the
revision they were given with. The admin Versions tab marks the version
`id_current_survey_versions` points at as current (not the newest), and
offers Restore on every other version. (Corrected 2026-11-19: an older
version of this page said restore copied into a new revision.)

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
| `POST` | `/admin/.../surveys/{id}/versions/{versionId}/restore` | Make that version current again. |
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

- `surveys/{surveyId}/editing` — `presence`, `draft_saved` and `version_published`, consumed by the Design tab. Granted for every survey the user may edit.
- `surveys/{surveyId}/responses` — `response_submitted`, consumed by the Answers tab. Granted for every survey the user sees in the admin list.

Two things must hold for an event to reach a screen (checked 2026-11-23):

1. **Grant.** The host subscribes a user's stream only to topics a `PluginRealtimePermissionEvent` listener allows (deny by default). `SurveyJsRealtimeGrantSubscriber` allows them with the admin list's rules. The topic registry (`SurveyJsRealtimeTopicSubscriber`) only lists them; it grants nothing.
2. **Event name.** `usePluginRealtime` listens for the SSE event `plugin/<pluginId>/<topic with params filled in>`, for example `plugin/sh2-shp-survey-js/surveys/18/editing`. `SurveyJsRealtimePublisher` sends every event under that name; the payload's `type` tells them apart.

The Design tab loads a draft saved elsewhere when it has no unsaved edits; with unsaved edits it keeps them, warns, and offers the saved version (saving still asks before overwriting). No polling. The Answers tab fetches a snapshot once and reloads on each `response_submitted` event.

Local development: if the hub listens on IPv4 only and the frontend reaches Symfony as `localhost`, the backend hands out the hub as `localhost:3001`, which Node may not reach (IPv6 first), and no event arrives. Set `SYMFONY_INTERNAL_URL=http://127.0.0.1/<backend path>` in the frontend's `.env.local`.

## Data flow on submission

1. The host frontend renders the `surveyjs` style for a public page.
2. The style fetches `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}?page_id=…&section_id=…` and renders the SurveyJS model. Every public call names the page and the section it is drawn on (the host passes `page` to plugin styles), with `language_id`, `preview` and `route[...]`. `SurveySectionResolver` lets the core check the caller may use that section (`PublicSectionAccessService`, H4) and reads every setting from the published section into `SurveySectionSettings`; nothing that limits a participant comes from the request. The survey's `{{variables}}` are filled with the section's variables (H1). The reply is never cached.
3. On submit, the style POSTs to `/cms-api/v1/plugins/sh2-shp-survey-js/published/{key}/submit` (same query); it sends only which response it is (response id, edit mode, page reached, language). The server applies login needed, open hours and once per user or window, the window in the participant's timezone.
4. `SurveysPublicController::submit()` calls `SurveyResponseService::submit()` which:
   - checks the once-per-user and schedule limits,
   - normalizes + sanitizes the answers (`SurveyAnswerNormalizer` + `SurveyJsHtmlSanitizer`),
   - saves the response through `SurveyResponseStore` as one row of the data table `sh2_surveyjs_<survey id>` with trigger `finished` (the participant's own unfinished row when they saved progress before),
   - publishes `surveys/{surveyId}/responses` on Mercure.
5. An open Answers tab receives the SSE event and reloads — no polling, no manual refresh.

### One row per response

| Moment | Row |
|--------|-----|
| First progress save (page change, autosave) | new row, trigger `started` |
| Later progress saves | same row, trigger `updated` (the page reached never goes back) |
| Submit | same row, trigger `finished`; progress sent later for it is ignored |
| Edit of a submitted response (`editMode`) | same row, stays `finished` |
| Discard, or delete in the core Data screen | core soft delete, trigger `deleted` (history kept) |

Besides the answers each row carries reserved columns: `response_id`, `survey_revision`, `guest_key`, `language`, `page_no`. A question may not use these names, nor the core's row columns; publishing refuses them (HTTP `422`).

A signed-in participant owns their row (`id_users`). A guest's row has no owner; it carries the **guest key**, a random 128-bit id the browser keeps and sends as the `X-SurveyJs-Guest-Key` header (the host BFF drops cookies the backend sets, so the older `_sh_sjs_vid` cookie only works for clients that call the backend directly). A row keeps the guest key only when a guest wrote it, so the next person on a shared browser cannot match a signed-in participant's response. A guest who signs in keeps their unfinished response, and it becomes theirs when they save it.

Uploaded files are core form files of the response's row: `FormFileUploadService::storeRecordFile` stores them under `user_<id>/` or `guest/` in the form files directory (a kept volume) with the core's type, content and size checks. The answer names each file by its key, the reserved column `uploaded_files` names every upload, and the plugin declares these columns with the value type `file`, so the core delivers, zips and erases them. An answer may only name keys of its own response (`isRecordFileKey`). Participants open a file through a signed link (`SignedFileUrlService`, one hour), handed out only with an answer they may read.

## Replies and requests

Every reply is the standard SelfHelp envelope (`status`, `message`, `error`, `logged_in`, `meta`, `data`), built by `SurveyJsApi` with the core's `ApiResponseFormatter`; a refusal's machine-readable reason is `data.reason` (for example `already_submitted_once`, `not_active`, `authentication_required`). Every write request is checked against a JSON Schema in `backend/src/Resources/schemas/requests/` before the action runs; a body that breaks it gets 400 with the field errors.

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
├── docs/developer/architecture.md  (this file)
├── backend/
│   ├── src/HumdekSurveyJsBundle.php
│   ├── src/Entity/{Survey, SurveyVersion}.php
│   ├── src/Repository/{Survey…, SurveyVersion…}Repository.php
│   ├── src/Service/{SurveyService, SurveyAccessService, SurveySectionResolver,
│   │                SurveyResponseStore, SurveyResponseRecord, SurveyResponseService,
│   │                SurveyResponseDraftService, SurveyDashboardService, SurveyPdfService,
│   │                SurveyAnswerNormalizer, SurveyJsHtmlSanitizer, SurveyJsRealtimePublisher,
│   │                SurveyJsApi, SurveyJsHealthCheck, SurveyFileAnswers, SignedFileUrlService, …}.php
│   ├── src/Controller/Api/V1/{SurveysAdmin, SurveysPublic, SurveysLicense}Controller.php
│   ├── src/EventSubscriber/{SurveyJsStyleRegistry, SurveyJsLookupRegistry, SurveyJsRealtimeTopic,
│   │                        SurveyJsDataAccessResources, SurveyJsSectionBinding}Subscriber.php
│   ├── src/Resources/{config/services.php, schemas/requests/*.json}
│   ├── src/Migrations/{Version20260522063620, Version20261117132938}.php
│   └── tests/
├── frontend/
│   ├── package.json
│   └── src/{index.ts, external.d.ts,
│            api/{surveys, surveys-admin}.ts,
│            styles/{SurveyJsStyle, GpxMapStyle}.tsx,
│            runtime/SurveyRuntime.tsx, …,
│            admin/{SurveyAdminPage, SurveyListPage, SurveyDetailPage, SurveyDesignerPage,
│                   SurveyAnswersPage, SurveyResponseView, SurveyVersionsPage,
│                   SurveySettingsPage}.tsx,
│            admin/{adminUrl, surveyListFilter, dataScreenUrl, definitionDiff}.ts,
│            admin/dashboard/SurveyAnalyticsPanel.tsx,
│            admin/ui/{AdminUi.tsx, admin-ui.css},
│            custom-questions/…,
│            theme/{mantine-adapter.css, surveyDefaults.ts}}
└── mobile/
    ├── package.json
    ├── tsconfig.json
    └── src/{index.ts, styles/SurveyJsReadOnlyStyle.tsx}
```

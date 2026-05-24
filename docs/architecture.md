# sh2-shp-survey-js — Architecture

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

The migration `Version20260522063620.php` creates the four plugin tables, seeds the three permissions, and seeds the `surveyJsTheme` lookup rows. `down()` is safe (drops only plugin-owned objects).

### Decoupling from the host

The bundle depends on host contracts, not concrete host services:

- `App\Plugin\Realtime\PluginRealtimePublisherInterface` — imported directly from the host. The CMS aliases this to its concrete `App\Plugin\Realtime\PluginRealtimePublisher` in `config/services.yaml`. The bundle ships **no** plugin-local null fallback; the host realtime layer must be present for the bundle to boot.
- `Service\DataTableWriterInterface` (the host wires its existing form-submission writer here; a `NullDataTableWriter` ships as the default so the bundle boots in isolation while the host writer is still being wired in).

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
   - hands the normalized cell list to `DataTableWriterInterface::writeRow()` (the host implements this),
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
│   │                DataTableWriterInterface, NullDataTableWriter, DataTableWriteResult}.php
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
│                   SurveyDashboardPage, SurveySettingsPage}.tsx,
│            custom-questions/register.ts,
│            theme/mantineBridge.ts}
└── mobile/
    ├── package.json
    ├── tsconfig.json
    └── src/{index.ts, styles/SurveyJsReadOnlyStyle.tsx}
```

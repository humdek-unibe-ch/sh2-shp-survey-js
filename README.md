# sh2-shp-survey-js

SurveyJS v2 plugin for the SelfHelp CMS. Provides:

- A Mantine-themed Survey Creator for admins (`survey-creator-react`).
- A runtime SurveyJS style for the frontend (`survey-react-ui`).
- Optional custom question types: GPX (Leaflet map preview), Video, and Tiptap rich-text.
- A standalone `gpxMap` style for rendering a GPX answer field on its own page.
- A readonly mobile renderer with an "Open on web" fallback for unsupported question types.
- A response dashboard, response list, PDF export, and collaborative-edit notifications via Mercure.

> **Looking for end-user documentation?**
> - [User guide](docs/user-guide.md) — create surveys, publish, restore versions, embed, configure.
> - [Mobile guide](docs/mobile-guide.md) — what the mobile renderer does and does not support today.
> - [Architecture](docs/architecture.md) — internals, services, schema, security.

Submissions land in the existing `data_tables` / `data_rows` / `data_cells` tables, normalized by `SurveyAnswerNormalizer`. HTML answers go through `SurveyJsHtmlSanitizer` before storage. The plugin owns four entities — `survey`, `survey_version`, `survey_run`, `survey_answer_link` — for surveys, version snapshots, response metadata, and per-question links into `data_cells`.

## Repository layout

```
sh2-shp-survey-js/
├── plugin.json                      Manifest (validated against the host schema)
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── docs/                            Plugin-specific docs
├── backend/                         Symfony bundle (Composer package)
│   ├── composer.json
│   ├── src/HumdekSurveyJsBundle.php
│   ├── src/Entity/                  Doctrine entities (Survey, SurveyVersion, ...)
│   ├── src/Controller/              Admin + public controllers
│   ├── src/Service/                 SurveyService, dashboard, normalizer, sanitizer, ...
│   ├── src/EventSubscriber/         CSP/sensible-page/route-registry subscribers
│   ├── src/Resources/config/        Bundle DI config
│   └── src/Migrations/              Plugin DB migrations
├── frontend/                        npm package (@humdek/sh2-shp-survey-js)
│   ├── package.json
│   ├── src/index.ts                 Exports `register` for the host PluginRuntime
│   ├── src/styles/                  surveyjs runtime style + gpxMap standalone style
│   ├── src/admin/                   Creator, Responses, Dashboard, Settings pages
│   ├── src/custom-questions/        rich-text / gpx / video custom question types
│   └── src/theme/                   Mantine -> SurveyJS theme bridge
└── mobile/                          npm package (@humdek/sh2-shp-survey-js-mobile, v1 readonly)
    ├── package.json
    └── src/index.ts                 Exports `registerMobile`
```

## Installation (development mode)

1. Build / publish locally (or use `npm link` and `composer link`) so the host can resolve the plugin packages.
2. From the SelfHelp backend:

   ```bash
   php bin/console selfhelp:plugin:install /d/TPF/SelfHelp/plugins/sh2-shp-survey-js/plugin.json
   ```

3. From the SelfHelp frontend (one-shot, regenerates the frontend lock file):

   ```bash
   npm run plugins:sync --backend http://localhost:8000
   npm install
   ```

4. From the SelfHelp mobile app (for an EAS profile):

   ```bash
   SELFHELP_API_TOKEN=... npm run plugins:sync -- production-default --backend https://cms.example.com
   npm install
   eas build --profile production-default
   ```

## Configuration

| Env var | Description |
| ------- | ----------- |
| `SURVEYJS_LICENSE_KEY` | Optional. SurveyJS license key. Read only by the admin license-key endpoint; never logged or echoed to non-admins. |

## CSP and external hosts

The plugin requires only `img-src` entries for OpenStreetMap and Carto tile hosts (Leaflet preview in the GPX question type). These are declared in `plugin.json` under `security.cspRules` and `security.externalHosts`. No `script-src 'unsafe-eval'` exception is required because the plugin uses the React-based SurveyJS packages (no Function-string evaluation).

## Versioning

Follows SelfHelp plugin SemVer:

- **patch** — no DB change, no migration shipped.
- **minor** — always ships a migration.
- **major** — breaking change.

## License

MPL-2.0 © Humdek, University of Bern.

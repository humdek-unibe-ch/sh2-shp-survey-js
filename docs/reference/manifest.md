# Plugin Manifest Reference

Audience: Plugin developers and integrators.
Status: active.
Applies to: `sh2-shp-survey-js`.
Last verified: 2026-06-12.
Source of truth: `plugin.json` (validated against the host `plugin-manifest.schema.json`), `backend/src/Entity/`, and `backend/src/Controller/`.

This page summarizes the plugin's declared contract. `plugin.json` is authoritative; when this page and the manifest disagree, the manifest wins.

## Identity and compatibility

| Field | Value |
| --- | --- |
| `id` | `sh2-shp-survey-js` |
| `name` | SurveyJS |
| `version` | 0.2.22 |
| `pluginApiVersion` | 0.1.0 |
| `compatibility.selfhelp` | `>=0.1.0` (open-ended minimum: the plugin-API axis, not the core axis, is the breakage contract) |
| `compatibility` (runtime) | php `^8.4`, node `^22`, react `^19`, reactNative `^0.83`, expoSdk `^55` |
| `archive.mode` | `connected` (PHP bundle installed by Composer from this repo; registry ships discovery metadata + frontend artifacts) |

It declares a conflict with the legacy `sh-shp-survey_js` plugin (replaced by this v2 plugin).

## Backend, frontend, mobile

- Backend bundle: `Humdek\SurveyJsBundle\HumdekSurveyJsBundle`; migrations namespace `Humdek\SurveyJsBundle\Migrations`; Composer package `humdek/sh2-shp-survey-js`.
- Frontend runtime: `dist/plugin.esm.js` + `dist/plugin.css` (format `esm`); dev entrypoint `http://localhost:5174/sh2-shp-survey-js/plugin.esm.js`.
- Mobile: `@selfhelp/sh2-shp-survey-js-mobile`, interactive WebView renderer (`readonly: false`); hosts the official SurveyJS runtime via a typed host-services bridge. Requires `compatibility.mobile` `^0.2.0` and the host-provided `react-native-webview` peer.

## Security

- `trustLevel`: `official`. `signing.required`: `false`.
- Capabilities: `backendBundle`, `databaseMigrations`, `readDataTables`, `writeDataTables`, `lookupOwnGroup`, `frontendStyles`, `mobileStyles`, `adminPages`, `realtimePublish`, `secretAccess`.
- CSP / external hosts: `img-src` allows `https://*.tile.openstreetmap.org` and `https://*.basemaps.cartocdn.com` for the GPX question's Leaflet preview. No `script-src 'unsafe-eval'` is required.

## Permissions

All default to the `admin` role:

| Key | Allows |
| --- | --- |
| `surveyjs.surveys.manage` | Create, edit, publish, delete surveys. |
| `surveyjs.surveys.view-responses` | View responses + dashboard. |
| `surveyjs.surveys.export-pdf` | Export responses as PDF. |
| `surveyjs.surveys.delete-responses` | Delete individual responses. |
| `surveyjs.surveys.export-csv` | Export responses as CSV. |
| `surveyjs.surveys.export-xlsx` | Export responses as Excel. |
| `surveyjs.surveys.export-json` | Export responses as JSON. |
| `surveyjs.surveys.upload-files` | Upload files attached to public submissions. |

## Data access

- Owned tables: `surveys`, `survey_versions`, `survey_runs`, `survey_answer_links`, `survey_files`, `survey_response_drafts` (Doctrine entities `Survey`, `SurveyVersion`, `SurveyRun`, `SurveyAnswerLink`, `SurveyFile`, `SurveyResponseDraft`).
- Owned data-table prefix: `sh2_surveyjs_`.
- Reads host tables: `data_tables`, `data_rows`, `data_cols`, `data_cells`, `lookups`, `languages`.
- Writes host tables: `data_tables`, `data_rows`, `data_cols`, `data_cells`.

Submissions land in the host `data_tables` / `data_rows` / `data_cols` / `data_cells` tables, normalized by `SurveyAnswerNormalizer`; HTML answers pass through `SurveyJsHtmlSanitizer` before storage.

## Realtime topics

| Topic | Required permission |
| --- | --- |
| `surveys/{surveyId}/responses` | `surveyjs.surveys.view-responses` |
| `surveys/{surveyId}/editing` | `surveyjs.surveys.manage` |

## Feature flags

| Flag | Default |
| --- | --- |
| `gpx` | off |
| `video` | off |
| `microphone` | off |
| `rich-text` | on |
| `pdf-export` | off |
| `dashboard` | on |
| `collab-editing` | on |

## Lookups

Plugin-owned lookup group `surveyJsTheme`: `default`, `modern`, `high-contrast`.

## Styles and admin pages

- Styles: `surveyjs` (embeds a published survey) and `gpxMap` (standalone GPX map renderer). Both are `frontendStyles` and cannot have children; grouped under the plugin's `Plugin: SurveyJS` style group.
- Admin page: slug `surveys`, label `SurveyJS`, permission `surveyjs.surveys.manage`, icon `tabler-clipboard-list`.

## API routes

Admin routes are mounted under `/cms-api/v1/admin/plugins/sh2-shp-survey-js/...` and public routes under `/cms-api/v1/plugins/sh2-shp-survey-js/...`. See `plugin.json#apiRoutes` for the authoritative list (controllers, methods, requirements, and per-route permissions).

| Group | Base path | Permission |
| --- | --- | --- |
| Surveys CRUD + drafts | `/admin/.../surveys[/{id}]` | `surveyjs.surveys.manage` |
| Versions (create/list/get/restore) | `/admin/.../surveys/{id}/versions` | `surveyjs.surveys.manage` |
| Presence | `/admin/.../surveys/{id}/presence` | `surveyjs.surveys.manage` |
| Dashboard + responses | `/admin/.../surveys/{id}/dashboard`, `/responses` | `surveyjs.surveys.view-responses` |
| Response PDF | `/admin/.../responses/{rid}/pdf` | `surveyjs.surveys.export-pdf` |
| Response delete | `/admin/.../responses/{rid}` (DELETE) | `surveyjs.surveys.delete-responses` |
| Bulk export (csv/xlsx/json) | `/admin/.../responses/export/{format}` | `surveyjs.surveys.export-{format}` |
| License key + health | `/admin/.../license-key`, `/health` | `surveyjs.surveys.manage` |
| Public survey (published/submit/progress/edit/files/choices) | `/plugins/.../published/{key}/...` | public (no route permission) |

The health endpoint (`/admin/plugins/sh2-shp-survey-js/health`, service `humdek.surveyjs.health_check`) backs the manifest `health` declaration.

## Configuration

| Env var | Description |
| --- | --- |
| `SURVEYJS_LICENSE_KEY` | Optional SurveyJS license key. Read only by the admin license-key endpoint; never logged or echoed to non-admins. |

## Versioning

Follows SelfHelp plugin SemVer: `patch` ships no DB change/migration, `minor` always ships a migration, `major` is a breaking change.

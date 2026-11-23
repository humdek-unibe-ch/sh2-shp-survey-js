# Plugin Manifest Reference

Audience: Plugin developers and integrators.
Status: active.
Applies to: `sh2-shp-survey-js`.
Last verified: 2026-11-19.
Source of truth: `plugin.json` (validated against the host `plugin-manifest.schema.json`), `backend/src/Entity/`, and `backend/src/Controller/`.

This page summarizes the plugin's declared contract. `plugin.json` is authoritative; when this page and the manifest disagree, the manifest wins.

## Identity and compatibility

| Field | Value |
| --- | --- |
| `id` | `sh2-shp-survey-js` |
| `name` | SurveyJS |
| `version` | 0.3.4 |
| `pluginApiVersion` | 0.1.0 |
| `compatibility.selfhelp` | `>=0.1.0` (open-ended minimum: the plugin-API axis, not the core axis, is the breakage contract). Survey storage works on any host; the question-title → column `display_name` enrichment is a progressive enhancement that needs core `>=0.1.23` (the `saveData()` field-labels parameter) and is silently skipped below it. |
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
| `surveyjs.survey.read` | Open the SurveyJS admin screens (page and menu entry), like `admin.page.read` for pages. |
| `surveyjs.survey.create` | Create surveys. The creator's roles that hold it get all four rights on the new survey. |
| `surveyjs.survey.update` | Edit the surveys the role has the update grant on. |
| `surveyjs.survey.publish` | Publish or restore a version of a survey the role may update. |
| `surveyjs.survey.delete` | Delete the surveys the role has the delete grant on. |

A permission says what a role may do at all; the grant says on which surveys.
Surveys are the data-access resource type `surveyjs_survey` (declared under
`lookups`), granted per role on the "Permissions for role" screen like pages,
data tables and assets. The admin role may do everything and gets no grants.

Who may see, export or delete a survey's answers is the grant on its data
table (`sh2_surveyjs_<survey id>`), through the core data screens; the plugin's
dashboard, responses and PDF need one of the four permissions plus that grant.
When the data table is created, the roles that may edit the survey get a grant
on it; after that the two grants are independent.

Placing a survey on a page needs the update right on the page and a view grant
on the survey, checked on section save and import (core H7).

## Data access

- Owned tables: `surveys`, `survey_versions` (Doctrine entities `Survey`, `SurveyVersion`); older names stay listed so the purger drops them on hosts that still have them. Uploads are core form files. Responses are rows of the core data tables `sh2_surveyjs_<survey id>`.
- Owned data-table prefix: `sh2_surveyjs_`.
- Reads host tables: `data_tables`, `data_rows`, `data_cols`, `data_cells`, `lookups`, `languages`.
- Writes host tables: `data_tables`, `data_rows`, `data_cols`, `data_cells`.

Submissions land in the host `data_tables` / `data_rows` / `data_cols` / `data_cells` tables, normalized by `SurveyAnswerNormalizer`; HTML answers pass through `SurveyJsHtmlSanitizer` before storage.

## Realtime topics

| Topic | Required permission |
| --- | --- |
| `surveys/{surveyId}/responses` | `surveyjs.survey.read` |
| `surveys/{surveyId}/editing` | `surveyjs.survey.update` |

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
Entry `surveyjs_survey` in the core lookup `resourceTypes` (data access, H6).

## Styles and admin pages

- Styles: `surveyjs` (embeds a published survey) and `gpx-map` (draws a route from `sample_points`); declared in the manifest with their fields (`styleGroups`, `fieldTypes`, `fields`, `styles[].fields`), which the host installer writes (rule 7.8). Both are `frontendStyles` and cannot have children; grouped under the plugin's `Plugin: SurveyJS` style group.
- Admin page: slug `surveys`, label `SurveyJS`, permission `surveyjs.survey.read`, icon `tabler-clipboard-list`. The host opens the page only for users holding it.

## API routes

Admin routes are mounted under `/cms-api/v1/admin/plugins/sh2-shp-survey-js/...` and public routes under `/cms-api/v1/plugins/sh2-shp-survey-js/...`. See `plugin.json#apiRoutes` for the authoritative list (controllers, methods, requirements, and per-route permissions).

| Group | Base path | Permission |
| --- | --- | --- |
| List, read, versions | `/admin/.../surveys[/{id}]`, `/versions` (GET) | any `surveyjs.survey.*` + read grant |
| Presence | `/admin/.../surveys/{id}/presence` (POST) | `create`, `update`, `publish` or `delete` |
| Create | `/admin/.../surveys` (POST) | `surveyjs.survey.create` |
| Edit, draft | `/admin/.../surveys/{id}` (PUT), `/draft` | `surveyjs.survey.update` + update grant |
| Publish, restore | `/admin/.../surveys/{id}/versions` (POST), `/restore` | `surveyjs.survey.publish` + update grant |
| Delete | `/admin/.../surveys/{id}` (DELETE) | `surveyjs.survey.delete` + delete grant |
| Answers: counts, chart rows, one response, its PDF | `/admin/.../surveys/{id}/dashboard[/results]`, `/responses/{rid}[/pdf]` (GET) | any `surveyjs.survey.*` + read grant on the data table |
| License key + health | `/admin/.../license-key`, `/health` | any `surveyjs.survey.*` |
| Public survey (published/submit/progress/edit/files) | `/plugins/.../published/{key}/...` | public; the core section check decides (page, section) |

The plugin has no route that lists, exports or deletes responses (removed in wave 8): that is the core Data screen, under the grant on the survey's data table.

The list reply is `{items, canCreate}`; every survey in it and the single-survey reply carry `rights: {update, publish, delete}` (route permission plus grant) and `dataTableId` (null before the first response or without the read grant on the table), so the admin screen shows only the actions that will succeed. A refused save or publish says why in `data.reason`: `draft_conflict` (409, someone else saved the draft), `answered_question_renamed` (409, a question with answers renamed or removed; the draft is saved), `reserved_question_name` (422; the draft is saved).

The health endpoint (`/admin/plugins/sh2-shp-survey-js/health`, service `humdek.surveyjs.health_check`) backs the manifest `health` declaration.

## Configuration

| Env var | Description |
| --- | --- |
| `SURVEYJS_LICENSE_KEY` | Optional SurveyJS license key. Read only by the admin license-key endpoint; never logged or echoed to non-admins. |

## Versioning

Follows SelfHelp plugin SemVer: `patch` ships no DB change/migration, `minor` always ships a migration, `major` is a breaking change.

# SurveyJS plugin: upgrade plan

- **Audience:** everyone who decides, builds or reviews the SurveyJS 3 upgrade.
- **Status:** draft for review. All questions are decided. Temporary: archived once the upgrade is done.
- **Applies to:** `sh2-shp-survey-js` 0.3.4 and its upgrade to SurveyJS 3. Also touches `sh-selfhelp_backend`, `sh-selfhelp_shared` and `sh-selfhelp_frontend`; mobile later.
- **Last verified:** 2026-11-17, from the code of 0.3.4, one test submission on a local instance, and core `main` at 0.1.44.
- **Source of truth:** the code for what is wrong today; [concept.md](concept.md) for where the upgrade goes; `concepts.md`, `rules.md`, `plugins.md` and `findings.md` in the `sh2-concepts` repository for the rules.

## 1. Goal

1. Move the plugin from SurveyJS 2.5.25 to SurveyJS 3 (3.2.5 on npm on 2026-11-16).
2. Give surveys the Mantine look of the site.
3. Make the plugin follow `rules.md` and `plugins.md`. It is the reference plugin and breaks several rules today.

Web first, mobile after. Point 3 is the largest part.

## 2. Decisions (2026-11-16, survey access 2026-11-17)

| Topic | Decision |
| --- | --- |
| Theme | Web always uses the site's Mantine theme, for now. Field `survey-js-theme` dropped. Mobile close to HeroUI |
| `dynamic_replacement` | Dropped. Authors write `{{variables}}` in the survey; all variables of the section work |
| `close_modal_at_end` | Becomes `close_modal_on_save`, works like the core form |
| `update_based_on`, `auto_session_key` | Added to SH2, work as in SelfHelp 1 |
| `allow_anonymous` | Stays. Off means a login is needed, even on an open page |
| Map style | Finished in this upgrade; reads `sample_points` as in SelfHelp 1 |
| Renames | `survey-js` to `survey_js`, `gpxMap` to `gpx-map`, in place by migration (section 4) |
| Answers | One home: the data store. `survey_answer_links` dropped |
| Unfinished surveys | A data row marked `started`, then `updated`, as in SelfHelp 1. `survey_response_drafts` dropped |
| `survey_runs` | Dropped. Version, guest key and language are reserved columns in the response row; start, changes and finish come from core data history and the row's trigger |
| Survey access | Surveys get their own resource type `survey` in core data access (H6). Permissions `surveyjs.survey.create`, `.update`, `.publish`, `.delete`; every admin endpoint checks the permission and the grant on that survey |
| New survey | The creator's roles that hold `surveyjs.survey.create` get all four rights on it, the same rule as pages (F14) and assets (6e). A non-admin cannot leave a survey with no managing role. Sharing a survey means granting it to another role |
| Publishing | The publish permission plus the update grant on the survey |
| Answers' access | When the survey's data table is created, the roles that can edit the survey also get a grant on the table (F15). After that the two grants are independent: a role can see the answers without editing the survey, or the other way round |
| Placing a survey | Needs the update right on the page plus a view grant on the survey, checked on save and on import |
| Response screens and exports | The plugin keeps the charts dashboard, one response drawn as the survey, and the PDF. It drops its response list and its CSV, Excel and JSON exports; the core data screens do this. Excel export is added to the core, for every data table (H5). Viewing, exporting and deleting answers use core data access, so the permissions `surveyjs.surveys.view-responses`, `export-*` and `delete-responses` are dropped |
| Core catalogue rows | Follow rule 7.8: the host installer writes the plugin's styles, fields and permissions from the manifest (H3), built first as its own task |
| Core additions | H1 to H6 (section 5) |
| Licence | The SurveyJS licence covers the developers, not the instances or their users. No question to SurveyJS needed |
| Rules | The upgrade and all new SH2 work follow `concepts.md`, `rules.md`, `plugins.md` |

## 3. What is wrong today

| # | Problem | Rule | Finding |
| --- | --- | --- | --- |
| 1 | The browser sends the survey's limits and the backend believes it. No page or section check. The licence key is returned to any caller that asks for PDF | 4.10, 7.7 | F109 |
| 2 | Deleting a user leaves their runs, answer copies, drafts and files | 2.11, 7.6 | F93 |
| 3 | The migration writes core catalogue tables | 7.8 | F112 |
| 4 | Naming (`gpxMap`, `survey-js`), self-declared `official` trust | 2, 7.4a | F114 |
| 5 | A service refers to three host interfaces that do not exist | | F111 |
| 6 | Guest answers are stored as user `1` (`CoreDataTableWriter`: `$userId ?? 1`). The core's `DataService` calls exactly this a security bug | 2.3, 2.7 | new |
| 7 | Every answer is stored twice; dashboard, exports and PDF read the plugin's copy | 1.5, 7.3 | new |
| 8 | Uploaded files go to `var/plugin-data/`, which is not one of the kept volumes: lost on update, not in backups, unless `SURVEYJS_UPLOAD_DIR` moves it. Read from the code default and the volume list in `concepts.md`; compose file not checked | 9.1 | new |
| 9 | Responses are not in the standard envelope; requests have no schema | 1.4 | new |
| 10 | The daily time window is computed in UTC, not in the participant's timezone | concepts: timezones | new |
| 11 | `close_modal_at_end` and the map style do nothing: the value is passed around and never acted on; the map reads a field that is never created | | new |
| 12 | Own response list and exports next to the core's data screens | 1.5 | new |
| 13 | A matrix answer is split into one column per row, named `<question>.<row value>`. A row value with a space (`I sleep well`, the default when rows are plain text) gives a key the core refuses, so the whole submit fails with 400. Found 2026-11-17; fixed in wave 5, where a complex answer becomes JSON in one cell | 1.3 | new |

Rows marked "new" are tracked by this plan and fixed by its waves; they are not proposed for `findings.md`.

Proposed for `findings.md`, a core problem this plan does not fix: after a development install, the backend's compiled container did not contain the plugin's services until `cache:clear` was run. Seen once, not reproduced.

**Core work this plan must follow.** Core changes from the form-list and CMS-app tasks, merged into `main` on 2026-11-17 (core 0.1.44, `@selfhelp/shared` 1.24.0), that the plugin runs on:

- Every save of a data record keeps a revision in `data_revisions`, and an interactive change must name the version it saw (`expected_version`); an older one is refused with `409` (rule 2.13, F143). A survey that autosaves into its data row creates a revision on each autosave and must carry the row's version: check both before wave 5, they may decide how often progress is saved.
- One query engine reads the data store for every reader (`DataQueryEngine`, F20 to F22). The plugin's dashboard and per-response view read through it.
- A record's file is served through the page and section that show it (F165). Survey files follow the same model.
- Form routes refuse keys a form does not declare (F157). The plugin writes through `DataService`, not the form routes; confirm it is not affected.

## 4. Renaming without breaking anything

Sections point at their style and field values by id, not by name, so a rename changes metadata, not content. What can still break, and how it is prevented:

- **Old code reading new names.** The web part, the mobile part and the backend read fields by name. All three move to the new names in the same plugin release, and the migration runs in that release.
- **Mobile apps already built.** A phone app carries the plugin version it was built with. An app built with the old plugin would no longer find its fields after the migration. Mobile is released with the new names before or together with the backend migration, or the mobile part reads both names for one release.
- **Proof.** The migration is run on a copy of an instance with existing survey sections; every section still shows its survey with its settings, before and after a page publish.

## 5. What the core has to add

| # | Addition | Needed for | Size | Status |
| --- | --- | --- | --- | --- |
| H1 | A service a plugin calls to replace variables as a given section on a given page would | Variables in a survey | Medium | approved |
| H2 | A way for a plugin's web part to close the popup its page is shown in (shared SDK) | `close_modal_on_save` | Small | approved |
| H3 | The installer writes a plugin's styles, fields, field types, style groups, permissions and lookups from the manifest (rule 7.8, F112). Its own task, built first | Problem 3 | Large | approved |
| H4 | A service a plugin calls to check "may this caller see page P, and is section S on it", returning the published section's fields. First check whether something like it exists | Problem 1 | Small to medium | approved |
| H5 | Excel export in the core data screens, next to CSV and JSON, for every data table | Problem 12 | Small to medium | approved |
| H6 | Plugins register their own data-access resource types. The `resourceTypes` lookup is closed to plugins today (`LookupPolicyRegistry`: `CLOSED`); it opens for types declared in `plugin.json`, written by the host installer and tagged with the plugin id, never by a plugin migration. `DataAccessSecurityService` and `role_data_access` accept them, the "Permissions for role" screen shows them next to pages, data tables, assets and groups, and purging the plugin removes their grants | Survey access | Small to medium | approved 2026-11-17 |

## 6. Why these decisions

**Response screens.** Once answers live only in the data store, the core data screens show survey answers like any form's, with no plugin code. The plugin keeps only what the core cannot do: charts, a response drawn as the survey, and its PDF. Result: one list and one export for all data, whatever collected it. Excel was the one thing the core lacked, so it is added to the core and every data table gets it.

**Core catalogue rows.** Rule 7.8 and `plugins.md` section 3 (decided 2026-11-12, F112): everything a plugin adds to core catalogue tables is declared in the manifest and written by the host installer; a plugin migration touches only its own tables. This upgrade adds and renames fields, so it falls under the rule. H3 is built first, as its own task, so the plugin's field changes are written once, the right way.

## 7. Waves

The work ships in waves, not as one large change. Each wave:

- is one reviewable change per repository, with its own tests and documents;
- leaves every repository working and releasable when it is merged;
- updates the version pins (`supports.core`, `compatibility.selfhelp`) when it couples plugin and core.

| Wave | What | Repositories | Depends on |
| --- | --- | --- | --- |
| 1 | SurveyJS 3 and the Mantine adapter: package update, `elementIdPrefix`, adapter stylesheet, a test page with every question type in light and dark | plugin (web) | nothing; can start now |
| 2 | H3: the installer writes a plugin's styles, fields, permissions and lookups from the manifest. Its own task | backend | nothing |
| 3 | H4 access check, H1 variable replacement, H6 plugin resource types in data access | backend, frontend | 2 for H6 (the installer writes the type from the manifest) |
| 4 | H2 close the popup, H5 Excel export | shared, frontend, backend | nothing |
| 5 | Answers in one home: unfinished surveys as data rows, guests without owner, version, guest key and language as row columns, `survey_answer_links`, `survey_response_drafts` and `survey_runs` dropped, files in `var/form-files` | plugin (backend, web) | nothing (core data history is in `main` since 2026-11-17) |
| 6 | Access and limits on the server: calls name page and section, settings read from the section, timezone, schemas and envelope, variables in the survey; the four survey permissions and grants, rights for the creator's roles, data-table grant on create, the grant check when placing a survey on a page, old response permissions dropped | plugin (backend, web) | 3, 5 |
| 7 | Fields and styles: declared in the manifest, renamed in place, `update_based_on`, `auto_session_key`, `close_modal_on_save`, `gpx-map` reading `sample_points` | plugin (all parts) | 2, 4, 6 |
| 8 | Admin screens: Creator on SurveyJS 3, dashboard on Chart.js, response list and exports removed; older developer documents rewritten | plugin (web) | 1, 4, 5 |
| 9 | Mobile | plugin (mobile), mobile app | 7 |

Waves 1 and 5 are built on the branch `feature/surveyjs-3-mantine` (2026-11-16, 2026-11-17), not yet reviewed or released.

Waves 1, 2, 4 and 5 do not depend on each other; H6 in wave 3 needs wave 2. Dropping `survey_response_drafts` in wave 5 discards surveys that are half filled at that moment; deploy it when no study is running, or tell participants.

### Wave 6c as built (2026-11-17)

- `SurveyJsApi` writes every reply as the core envelope (core `ApiResponseFormatter`) into the response the controller holds, so the guest cookie and the licence header stay; a refusal's reason is `data.reason`. Write requests are checked with `justinrainbow/json-schema` against the plugin's own schemas (`Resources/schemas/requests/`), since the core validator reads only the core's schema folder. Response schemas are not written yet.

### Wave 6b as built (2026-11-17)

- **Permissions and grants.** `SurveyAccessService` checks the grant on a survey (resource type `surveyjs_survey`, declared in the manifest's `lookups`, H6) after the route permission; the list is filtered by read grants; creating grants the creator's roles that hold `create` (admin excluded); deleting revokes the survey's grants. `SurveyJsDataAccessResourcesSubscriber` lists the surveys on the role screen.
- **Answers.** Dashboard, responses, PDF, response delete and staff file access check the grant on the survey's data table. When `SurveyResponseStore` creates the table, the roles with the update grant on the survey get full rights on it (F15).
- **Placing.** Needed a core hook: H7, `SectionFieldBindingEvent`, dispatched by `SectionTableBindingGuard` on section save and import. `SurveyJsSectionBindingSubscriber` refuses a survey the editor may not see. H7 is not in section 5 above; added during the build.
- **Known limits.** A plugin route may only use the plugin's own permissions, so a role that may read a survey's data table but holds none of the four survey permissions uses the core data screens, not the plugin dashboard. The creator grant and the data-table grant were not run live with a non-admin account; unit tests cover the checks, the core tests cover H7.

### Wave 6a as built (2026-11-17)

- **Calls name page and section.** The host passes `page` (`id`, `languageId`, `preview`, `routeParams`) to plugin styles through `PluginStyleHost` (frontend, shared SDK `IPluginStylePage`); the runtime sends them as query parameters on every public call. `SurveySectionResolver` runs the core check (H4) and reads the settings; the timezone is the participant's, else the CMS default. Variables come from H1; `dynamic_replacement`, the client config header and the `choices` endpoint are gone.
- **Still on the client:** the `timeout` countdown. Its value now comes from the section, but the server cannot check it yet: a row's timestamp is its last change, and the start of a response is only in core data history. Open point.
- **Not yet:** survey files are still served by signed URL, not through page and section (F165).

### Wave 5 as built (2026-11-17)

- **Store.** `SurveyResponseStore` is the only code that touches responses: one row per response in `sh2_surveyjs_<survey id>`, trigger `started` (first progress save), `updated` (later saves), `finished` (submit). Reserved columns: `response_id`, `survey_revision`, `guest_key`, `language`, `page_no`; publishing refuses a question with one of these names or a core row column (`422`).
- **Version check (rule 2.13).** The plugin writes as a trusted system writer (`RecordWriteContext` with no expected version), like other plugin writes: the participant never edits a row by number, only through the plugin, which finds the row itself. Every save still keeps a revision; progress is saved on page change and on the optional autosave interval, so the number of revisions follows those settings.
- **Guest key.** The visitor cookie never reached a browser: the BFF drops cookies the backend sets. The web runtime now keeps a random 128-bit guest key in `localStorage` and sends it as `X-SurveyJs-Guest-Key`; the backend still accepts the signed cookie from clients that call it directly. A row keeps the guest key only when a guest wrote it. Open point for review: this is a plugin-side choice, a core way for plugins to keep a guest identity (for example a BFF-managed cookie) would replace it.
- **Exports.** The plugin's CSV, Excel and JSON export routes and buttons are removed in this wave already (they read the dropped tables); the response list, detail, PDF and delete stay and read the store until wave 8. The `export-*` and response permissions stay until wave 6.
- **Lost on upgrade.** Unfinished drafts, and the revision and visitor id of earlier responses (a plugin migration may not write core tables). Earlier guest responses (stored with user 1) no longer count for guest limits. Uploads under the old default folder must be moved to `var/form-files/surveyjs` or `SURVEYJS_UPLOAD_DIR` set.
- **Not tested here.** Mercure delivery of `response_submitted` (no hub in the local check). The route rows of the removed export routes stay in a dev database until the next plugin update re-syncs routes.

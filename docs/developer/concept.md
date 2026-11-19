# SurveyJS plugin: concept

- **Audience:** everyone who designs, builds or reviews the SurveyJS plugin.
- **Status:** draft for review. This page describes how the plugin will work after the upgrade to SurveyJS 3. Version 0.3.4 differs in several places; those differences, the decisions and the order of work are in the [upgrade plan](upgrade-plan.md).
- **Applies to:** `sh2-shp-survey-js` from the SurveyJS 3 upgrade on. Web first, mobile after.
- **Last verified:** 2026-11-17.
- **Source of truth:** the workspace documents `concepts.md`, `rules.md` and `plugins.md` in `sh2-concepts`. Where this page disagrees with them, they win. Once the upgrade is built, the code.

## 1. In short

An editor builds a survey in the SurveyJS Creator, publishes it, and places it on a page as a `surveyjs` section. Participants fill it in; their answers land in the SelfHelp data store like the answers of any form.

## 2. Who owns what

**The plugin owns the survey. The core owns everything else.**

| The plugin owns | The core owns |
| --- | --- |
| The survey definition and its versions | Who may see the page; who may edit, publish and share a survey |
| The Creator (authoring screen) | Where answers are stored |
| Drawing the survey | Reactions to answers: actions, jobs, reminders |
| The charts dashboard, one response drawn as the survey, its PDF | Response lists, export (CSV, Excel, JSON), data access, audit, removing a user's data |
| Turning SurveyJS answers into data columns | Variables, conditions, translations, cache |

If the plugin needs something the core has, it uses the core. If the core lacks it, the core is extended first.

## 3. The life of a survey

| Step | What happens | Where it is kept |
| --- | --- | --- |
| Create | An editor creates a survey; their roles that hold `surveyjs.survey.create` get all four rights on it | `surveys`, core data access |
| Write | An editor builds the survey in the Creator; each save updates the draft | `surveys` |
| Publish | The draft becomes a new version that never changes | `survey_versions` |
| Place | An editor adds a `surveyjs` section to a page and picks the survey. Needs the update right on the page and a view grant on the survey | The section's fields |
| Show | The web part asks the plugin backend for the survey, naming the page and the section. The backend checks access, reads the section's settings, fills in variables | Nothing is stored |
| Answer | The participant fills it in; progress is saved as they go | One data row, marked `started`, then `updated` |
| Finish | The participant submits | The same row, marked `finished` |
| React | Actions on that data table plan mails, reminders, group changes | `scheduled_jobs` |
| Look | Editors see answers in the core data screens and in the plugin's dashboard | Read from the data store |

Publishing refuses to rename or remove a question that already has answers, so a data column keeps its meaning.

## 4. What is stored where

| Data | Home | Why |
| --- | --- | --- |
| Survey, draft, versions | Plugin tables `surveys`, `survey_versions` | Structure, no user data |
| Answers, finished or not | Data store, table `sh2_surveyjs_<survey id>`, one row per response | What a user enters never gets its own SQL table. Export, data access, actions and user cleanup then need no plugin code |
| Which version a response used, the guest key, the language | Reserved columns in the response row | To redraw old answers with the right version. No plugin table holds user data |
| When a response started, changed and finished | Core data history and the row's trigger (`started`, `updated`, `finished`) | The core keeps the history of every data row |
| Uploaded files | Core form files of the response's row (`var/form-files`), named by key in the answer | The core keeps, delivers, exports and erases them like a form's files; the folder is kept on update and backed up |
| Licence key | Environment variable `SURVEYJS_LICENSE_KEY` | Never in the package. Sent only to the screens that need it: the Creator, the dashboard and the PDF export |

- A question's `name` is the column key and never changes. Its `title` is the column label and may change.
- A complex answer (matrix, dynamic panel) is JSON text in its cell.
- A guest's row has no owner.
- The plugin's own tables hold no user data, so removing a user needs no plugin code.
- A file answer names core form file keys (`[{name, type, content: <key>}]`, or `{key, …}` for GPX and recordings). Its column is declared with the value type `file`; the reserved column `uploaded_files` names every upload. An answer may only name files of its own response.

## 5. The section fields

How a survey behaves on a page is set on the `surveyjs` section, not on the survey, so the same survey can be placed twice with different rules. The server reads these fields from the published section and enforces them (section 6).

Style `surveyjs`, fields added by the plugin:

| Field | What it does |
| --- | --- |
| `survey_js` | Which survey the section shows |
| `once_per_user` | One response per user |
| `once_per_schedule` | One response per daily time window |
| `start_time`, `end_time` | Daily window when the survey is open |
| `timeout` | Minutes until a started survey expires |
| `own_entries_only` | Only the participant may resume or edit their response |
| `allow_anonymous` | Off means the survey needs a login, even on a page open to everyone |
| `restart_on_refresh` | Start over on every reload |
| `auto_save_interval` | Save progress every N seconds |
| `update_based_on` | Name of the column that identifies a response row; its value comes from the URL. Several surveys can then fill one row |
| `auto_session_key` | Gives each guest a private key in the link, so guests sharing one invite link do not see each other's answers and can continue on another device |
| `label_survey_done`, `label_survey_not_active`, `label_survey_timeout`, `label_login_required`, `label_loading`, `label_submitting`, `btn_new_response_label`, and the core form's `alert_success_title`, `alert_success`, `alert_error_title`, `alert_error` | Every text the participant sees (translatable). Empty shows nothing; only the error texts have a default |
| `redirect_at_end` | Where to go after submitting |
| `close_modal_on_save` | Close the popup the page was opened in, like the core form |
| `url_params` | Pass URL parameters into the survey |
| `save_pdf` | Participant may download their answers as PDF |

Core section fields the plugin works with: `condition`, `css`, `css_mobile`, and `data_config`, whose loaded data feeds the variables in the survey (section 7).

Style `gpx-map` draws a route on a map from `sample_points`: a list of points, a whole GPX answer, or a variable resolving to either.

## 6. Access and limits

The server decides, the client draws.

- Every public call names the page and the section. The backend checks that the caller may see the page and that the section is a `surveyjs` section on it, and reads every setting from the published section. Nothing that limits a participant comes from the request.
- The participant is the logged-in user. A guest is recognised by a random guest key the browser keeps and sends with each call, or by the key in the link when `auto_session_key` is on. That link works as a password.
- The daily window is meant in the participant's timezone, then the CMS default.
- The call that shows a survey is never cached: its answer depends on the clock and the participant.
- A survey is a resource in core data access, like a page or an asset. `surveyjs.survey.read` opens the SurveyJS admin screens, like `admin.page.read` for pages. Every admin action needs a permission (`.read`, `.create`, `.update`, `.publish`, `.delete`) and the grant on that survey. Publishing needs the publish permission and the update grant.
- The creator's roles that hold `surveyjs.survey.create` get all four rights on a new survey. A non-admin cannot leave a survey with no role that manages it. Sharing a survey means granting it to another role.
- Who may see, export or delete a survey's answers is the grant on its data table, through the core data screens. When the survey creates its table, the roles that can edit the survey get the grant on the table. After that the two grants are independent. Deleting a survey deletes its answers too (its data table through the core, and its uploaded files), so once the table exists it also needs the delete grant on the table. Deleting one response is the core soft delete: the row, its history and its files stay until explicit erasure (rule 2.5).
- Placing a survey on a page needs the update right on the page and a view grant on the survey, checked on save and on import.
- Every request is checked against a JSON Schema, and every reply uses the standard SelfHelp envelope.

One accepted exception: the rules say no style fetches its own data from the client, and this one does. `plugins.md` decided that a public plugin endpoint behaves like a core form, and lock state and progress must not be cached with the page.

## 7. Variables in a survey

An author writes `{{variables}}` directly in the survey: in a title, a description, a choice, a default value. When the survey is shown, the backend replaces them with what is valid at the section where the survey is placed: user and system values, global values, route parameters, and data loaded by the section's `data_config`.

- A survey is written once and placed on many pages. A variable that depends on a section's data works only where that data is loaded. The Creator can list the always-valid variables; it cannot check the rest.
- Replacement works on the survey's text values, never on its JSON as one string, so a value cannot change the survey's structure.

## 8. The look

On web a survey always looks like the site. There is no theme choice for now.

SurveyJS 3 is styled through design tokens (CSS variables starting with `--sjs2-`), shared by the survey, the Creator, the dashboard and the PDF. The plugin ships a **Mantine adapter**: one stylesheet that points those tokens at Mantine's own variables. It refers to Mantine's variables and does not copy their values, so a change of site theme or of light and dark mode restyles the survey with no plugin code.

The adapter styles SurveyJS's controls; it does not swap them for Mantine components. A control that still looks foreign gets targeted CSS. A question's error is shown under its field, as in a Mantine form. The Creator has no Theme tab.

Mobile comes later and gets a look close to HeroUI by the same method.

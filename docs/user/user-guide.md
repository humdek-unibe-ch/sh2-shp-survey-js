# SurveyJS Plugin — User Guide

Audience: Non-technical users, admins, and operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-11-19.
Source of truth: Observable product behavior of the current build.

This guide walks an editor through everything they can do with the
SurveyJS plugin once it is installed in their SelfHelp CMS:

1. [Find your surveys](#1-find-your-surveys)
2. [Create a survey](#2-create-a-survey)
3. [Edit a survey](#3-edit-a-survey)
4. [Publish a version](#4-publish-a-version)
5. [Compare and restore versions](#5-compare-and-restore-versions)
6. [Put a survey on a page](#6-put-a-survey-on-a-page)
7. [Configure survey-style parameters](#7-configure-survey-style-parameters)
8. [See the answers](#8-see-the-answers)
9. [Permissions reference](#9-permissions-reference)
10. [Mobile experience](#10-mobile-experience)
11. [Troubleshooting](#11-troubleshooting)

> The surveys live under **Admin → SurveyJS**. The plugin page at
> **Admin → Plugins** is only for installing, updating and removing the
> plugin itself.

You only see the buttons for what your roles allow. If a button you
expect is missing (for example **New survey** or **Delete**), ask an
administrator; see [Permissions reference](#9-permissions-reference).

---

## 1. Find your surveys

Open **Admin → SurveyJS**. The list shows the surveys shared with your
roles.

- **Search** by part of the name or the survey ID.
- **State** shows the active surveys by default; choose **Archived**
  or **All** to see the others.
  An archived survey has an **Archived** badge next to its name.
- Click **Apply Filters** to show the result. **Reset** goes back to
  all active surveys; **Refresh** reloads the list.
- **Answers** is the number of responses. Click it to open them in the
  Data screen. A dash means you may not see this survey's answers.
- The icons on each row are, in order: **Answers** (eye), **Edit**
  (pencil), **Duplicate**, **Archive** and **Delete**.

Click a survey's name to open it. A survey has four tabs: **Design**,
**Answers**, **Versions** and **Settings**. **All surveys** at the top
takes you back to the list; the browser's back button works too.

---

## 2. Create a survey

1. Click **New survey** (top right).
2. Enter a name. Only editors see it; you can change it later in
   **Settings**.
3. Click **Create and edit**.

The survey opens on the **Design** tab, empty and not published. It gets
a survey ID (`SV_...`) that never changes; the page section stores this
ID.

To start from an existing survey, click **Duplicate** on its row. The
copy is a new draft with the same questions and no answers; publish it
when it is ready.

---

## 3. Edit a survey

The **Design** tab holds the SurveyJS editor:

| Tab | Purpose |
|---|---|
| **Designer** | Add, arrange and set up questions. |
| **Preview** | The survey as a participant sees it. |
| **Logic** | Show or hide questions, calculated values, triggers. |
| **JSON Editor** | The survey as text; useful to copy between surveys. |

The survey always has the site's look and follows light and dark mode,
so there is no theme to choose.

- **Save draft** (or the editor's own save button) keeps your work.
  Participants do not see a draft.
- "Unsaved changes" means you have edits that are not saved yet. The
  browser warns you if you close or reload the page then. Moving to
  another tab of the survey keeps your edits.
- When the survey is saved in another window or by someone else, an
  open editor shows that draft right away if you have no unsaved
  changes. If you do, it keeps them and warns you; **Load the saved
  version** switches to the other draft.
- If someone else saved the survey while you were editing, saving
  stops and asks you to either **load the saved version** (your edits
  are dropped) or **overwrite with your version**.
- When someone else has the survey open, a note names them.
- Without the right to edit, the editor is read-only.

### Rich-text editing

For text that accepts formatting (descriptions, titles, HTML), the
plugin can switch the editor's text boxes to a rich-text editor. Per
survey:

1. In the **Designer**, select the survey itself and open
   **General**.
2. Turn on **Rich-text editor (Tiptap)**.
3. Save and reopen the survey.

---

## 4. Publish a version

Participants always get a published **version**, never the draft. The
bar above the editor shows where you are:

- **Not published yet**: participants cannot answer the survey.
- **Published vN**: participants get version N.
- **N unpublished changes**: the draft differs from the published
  version (pages, questions and settings added, removed, changed or
  moved).

**Publish** is only active when there is something to publish. Click it
to make the current editor content the new version. A published version
never changes.

> **You cannot rename or remove a question that already has answers.**
> A question's **name** is where its answers are stored. If your changes
> rename or delete a question that already has answers, publishing is
> refused with a message. To change the wording, edit the question's
> **title** (always safe). To ask something new, add a new question.
>
> A question nobody has answered yet may still be renamed or removed.

> **A question's name may use letters, digits, `_` and `.`, and must
> start with a letter** (for example `mood_score`, not `mood score` or
> `1st`). A few names are used by the system (such as `id` or
> `language`). Publishing such a name is refused with a message naming
> the question. The title can be anything.

---

## 5. Compare and restore versions

The **Versions** tab lists every published version, newest first.

To see what changed between two versions:

1. Tick two versions.
2. Click **Compare selected**.

The comparison lists every page, question or setting that was added,
removed, changed or moved.

To go back to another version, click **Restore** on its row and
confirm. Participants get that version again from now on, and the
editor is reset to it (unsaved or unpublished edits are replaced). No
version is deleted or added; the list marks the one participants get
as **current**. Answers already given keep the version they were given
with. **Restore** shows only if you may publish.

---

## 6. Put a survey on a page

1. Open the page in **Admin → Pages** and add a section with the style
   **SurveyJS**.
2. In the section's **Survey** field, pick the survey. You can only
   pick surveys shared with your roles.
3. Set how it behaves on this page (see section 7) and save.

The section shows the latest published version. Archived surveys are
not shown to participants.

---

## 7. Configure survey-style parameters

The `surveyjs` style's fields are stored on the section, so different pages
can show the same survey with different settings. The server reads every
limit from the published section; the browser cannot change them.

| Field | Effect |
|---|---|
| Survey (`survey_js`) | Which survey the section shows. |
| Once Per User / Once Per Schedule | The participant may answer once, or once per daily window. |
| Start Time / End Time | The daily window when the survey is open, in the participant's timezone. |
| Timeout (minutes) | The survey closes this long after the participant started it; 0 = off. |
| Allow Anonymous | Visitors who are not signed in may answer. |
| Restart on Refresh / Auto-Save Interval | Start over on every reload / save progress every N seconds. |
| Redirect At End / Close Popup On Save | Where to go, or close the page's popup, after submitting. |
| Save as PDF | The participant can download their answers as a PDF. |
| URL Parameters / Update Based On / Auto Session Key | Pass link parameters into the survey / continue the row named by a link parameter / give each guest a private link key. |

### Texts the participant sees

All texts are translatable and empty by default. **An empty text shows
nothing**, except the two error texts, which fall back to a default so a
participant always knows when their answers were not sent.

| Field | Shown when |
|---|---|
| Label - Loading | Next to the spinner while the survey loads (empty: spinner only). |
| Label - Login Required | To a visitor who is not signed in, when anonymous answers are off. |
| Label - Survey Not Active | Outside the start and end time. |
| Label - Survey Done | When the participant comes back after answering and once per user / per schedule blocks another answer. |
| Label - Survey Timeout | When the timeout ran out while answering. |
| Label - Submitting | Next to the spinner while the answers are sent (empty: spinner only). |
| Success Title / Success Message | After submitting (the same fields as a core form). |
| Button - New Response | After submitting, a button to answer again. Never shown with once per user or once per schedule. |
| Error Title / Error Message | When the answers could not be sent (empty: a default text). |

---

## 8. See the answers

Each survey has its own data table in the **Data** screen, like any
form. Every response is one row, with one column per question:

- A participant who saved progress but has not submitted yet has a row
  marked **started** or **updated**.
- A submitted response is marked **finished**.

To list, filter, export (CSV, Excel, JSON) or delete answers, use the
**Data** screen. **Answers in Data screen** on the survey, or the
answer count in the survey list, opens the right table.

The survey's **Answers** tab shows:

- how many responses are finished and how many are started but not
  finished;
- a chart per question for the finished responses (updates by itself
  when new responses come in);
- **Look at one response**: enter a record ID from the Data screen (or
  a response ID) and click **Show**. The response is drawn as the
  survey, read-only, with the version it was given with. **PDF**
  downloads it.

You need the right to see the survey's data table for all of this; see
the next section.

---

## 9. Permissions reference

Five permissions say what a role may do with surveys at all:

| Permission                | Lets a role                                      |
|---------------------------|--------------------------------------------------|
| `surveyjs.survey.read`    | open the SurveyJS screens (needed for any of the others in the admin) |
| `surveyjs.survey.create`  | create surveys                                   |
| `surveyjs.survey.update`  | edit surveys                                     |
| `surveyjs.survey.publish` | publish a new version or restore an old one      |
| `surveyjs.survey.delete`  | delete surveys, with all their answers and files (once a survey has answers, the role also needs Delete on its data table) |

Which surveys a role may use is set separately: open **Admin → Roles**,
choose **Surveys permissions** in the role's menu and tick the rights
per survey, like pages and data tables. Ticking Update or Delete also
ticks **View**, because a survey you cannot see cannot be changed. When
you create a survey, your
roles that may create surveys get every right on it.

Who may see a survey's answers is set on its data table in the same
screen (**Data tables permissions**). The roles that could edit the
survey get that right when the first answer arrives.

To put a survey on a page you need to be allowed to edit the page and
to see the survey.

---

## 10. Mobile experience

The mobile package (`@selfhelp/sh2-shp-survey-js-mobile`) hosts the
**official SurveyJS runtime** inside a self-contained WebView, so the
mobile app and CMS mobile preview have **full parity with web**:
mobile users fill in every question type, get the same validation and
conditional logic, **submit a real response**, see the completion
screen, and follow the configured redirect. Submitting from the CMS
mobile preview stores a real response exactly like web preview.

See the [Mobile guide](./mobile-guide.md) for the supported/unsupported
question matrix and configuration, and the
[Mobile architecture](../developer/mobile-architecture.md) for the
WebView + typed host-services bridge design.

---

## 11. Troubleshooting

### "The survey is empty / shows a spinner forever"

- The plugin couldn't find a published version for the slug. Check
  the survey detail page → **Versions** tab and click
  **Make current** on the version you want served.

### "I can't see the SurveyJS Creator toolbar"

- The Creator depends on `survey-creator-react` being installed in
  the host frontend's `node_modules`. Re-run
  `npm install --workspaces` (managed mode CI handles this
  automatically).

### "Rich-text editing isn't showing the Tiptap toolbar"

- The per-survey opt-in is missing. Open the **JSON** tab and add
  `"richTextEditor": true` at the top level.

### "I removed a question, but old responses still show it"

- That's by design. Responses are bound to a **specific version**;
  the diff between versions is intentionally preserved so audits
  remain reproducible. Use the **Compare** view to confirm the
  question was actually removed in the newer revision.

### "GDPR erasure ate someone's responses but I see leftover rows"

- The plugin deletes the linked `data_rows` + `data_cells` in the
  same transaction. If the host's Data Browser still shows rows,
  check the **Audit Logs** page for the erasure operation; the
  transaction may have rolled back due to FK conflicts in another
  plugin. Open a GitHub issue with the operation id.

### "I want to call the SurveyJS API directly from another plugin"

- Use the host's `App\Plugin\Realtime\PluginRealtimePublisher` to
  publish events on `surveys/{surveyId}/responses`; never reach into
  this plugin's services directly. The `surveyjsAnswers` style is
  the recommended consumer.

---

## Related

- [Plugin architecture](../developer/architecture.md)
- [Validate-plugin CI workflow](../../.github/workflows/validate-plugin.yml)
- [Manifest schema](../plugins/plugin-manifest.schema.json)
- [SurveyJS Creator docs](https://surveyjs.io/survey-creator/documentation)
- [SurveyJS runtime API](https://surveyjs.io/form-library/documentation/api-reference/survey-data-model)

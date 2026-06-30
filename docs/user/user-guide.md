# SurveyJS Plugin — User Guide

Audience: Non-technical users, admins, and operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-06-26.
Source of truth: Observable product behavior of the current build.

This guide walks an admin through everything they can do with the
SurveyJS plugin once it's installed in their SelfHelp CMS:

1. [Create a survey](#1-create-a-survey)
2. [Edit a survey with SurveyJS Creator](#2-edit-a-survey-with-surveyjs-creator)
3. [Publish a version](#3-publish-a-version)
4. [Monitor & compare versions](#4-monitor--compare-versions)
5. [Restore a previous version](#5-restore-a-previous-version)
6. [Embed a survey in a CMS page](#6-embed-a-survey-in-a-cms-page)
7. [Configure survey-style parameters](#7-configure-survey-style-parameters)
8. [Collect responses](#8-collect-responses)
9. [Display responses on a page](#9-display-responses-on-a-page)
10. [Permissions reference](#10-permissions-reference)
11. [Mobile experience](#11-mobile-experience)
12. [Troubleshooting](#12-troubleshooting)

> All admin routes live under **Admin → SurveyJS Surveys**. The
> Plugin Management page at **Admin → System Tools → Plugin
> Management** is only for installing / updating / removing the
> plugin itself.

---

## 1. Create a survey

1. Open **Admin → SurveyJS Surveys**.
2. Click **New survey** (top-right).
3. Enter a **name** (free text, shown to the admin) and a **key slug**
   (URL-safe, used by the `surveyjs` style to reference the survey).
4. Optionally pick a **theme** (Default / Modern / High contrast).
5. Click **Create**.

The survey is created as a draft with no versions yet. SurveyJS
Creator opens immediately.
The plugin also generates a stable `survey_id` (`SV_...`) for external
references. The generated `survey_id` is the public identifier.

> **Tip**: the key slug is what you'll paste into the `surveyjs`
> style's "Survey" dropdown, so pick something meaningful
> (`patient-intake-v2`, not `survey-1`).

---

## 2. Edit a survey with SurveyJS Creator

The SurveyJS Creator hosts the full Creator v2 UI:

| Tab          | Purpose                                                 |
|--------------|---------------------------------------------------------|
| **Designer**  | Drag-and-drop question editor.                          |
| **Test**      | Live preview of the survey from the respondent's POV.   |
| **Logic**     | Conditional show/hide, calculated fields, triggers.     |
| **JSON**      | Raw JSON view; useful for copy-pasting between surveys. |
| **Translations** | Multi-locale strings; ships with the host's locales. |

### Rich-text editing

For text fields that accept HTML (`description`, `title`, `html`,
`correctAnswerText`), the plugin can opt the host's Tiptap-based
rich-text editor into the Creator's property grid. To enable it
**per-survey**:

1. Open the **JSON** tab of the Creator.
2. Add `"richTextEditor": true` at the top level of the survey
   definition.
3. Save. The relevant property editors switch from a plain `<input>`
   to the Tiptap toolbar.

> **Why per-survey?** Some surveys ship to mobile devices that don't
> bundle Tiptap; keeping it opt-in lets you decide which surveys
> need it.

### Mantine theming

The Creator is mounted inside a Mantine `Paper` shell so the
toolbar, modals, and panel chrome inherit the host's color scheme
and spacing. The respondent-facing renderer (`survey-react-ui`)
defaults to its own theme — switch it to the **Default** theme in
the survey's *Themes* tab to get the Mantine-bridged colors.

---

## 3. Publish a version

A survey is *always* served from a **version**, never directly from
the draft. The Designer header shows the publish state at a glance:

- **Draft only** badge — never been published. The runtime style
  cannot serve the survey yet.
- **Published vN** badge — at least one revision exists; the public
  renderer serves the latest one.
- **N unpublished changes** orange badge — the draft differs from the
  latest published revision. Counts pages, questions, and settings
  that were added / removed / modified / moved.

The **Publish** button (orange) is **only enabled when there are
unpublished changes**. This prevents redundant revisions that contain
no real difference. When the draft is identical to the published
version, the button is disabled and the helper text reads "Publish
is disabled until you make changes".

To publish:

1. Edit the survey in the Creator. The orange badge updates as you
   work.
2. Click **Publish (N)** in the Designer header. `N` is the live
   change count.
3. The plugin creates a new immutable `survey_versions` row, computes
   a SHA-256 over the definition, and sets it as the current version
   (`surveys.id_current_survey_versions`).
4. The change badge resets to zero and the **Published vN+1** badge
   updates immediately.

Every published version is durable; you cannot delete a version that
has even one response attached to it.

> **You cannot rename or remove a question that already has responses.**
> A question's **name** is its permanent storage key — it is how every saved
> answer is linked across versions. If your draft renames or deletes a question
> that already has stored responses, **Publish is rejected** with a clear
> message. To change the *wording* a respondent sees, edit the question's
> **title** instead (the title is only a display label and is always safe to
> change). To ask something genuinely new, add a **new** question with a new
> name. This is what keeps your collected data from splitting into two columns
> when you edit a live survey.

> **Renaming**: hover the survey name in the Designer header and
> click the pencil icon (or double-click the title) to rename inline
> without leaving the Designer. The same shortcut is available in the
> survey list (pencil icon next to each row, or **right-click → Rename**).

---

## 4. Monitor & compare versions

The **Versions** tab on the survey detail page shows:

| Column        | What it tells you                                  |
|---------------|----------------------------------------------------|
| Compare       | Two checkboxes per row to select base + target.    |
| Revision      | Auto-incremented integer with `current` badge.     |
| Published at  | Local timestamp (server stores UTC).               |
| By            | User id that published this revision.              |
| SHA-256       | Content hash; identical hashes = identical JSON.   |
| Restore       | Promote that version back to the live one.        |

### Comparing two revisions

1. Tick the **Compare** checkbox on a base revision (turns blue).
2. Tick a second checkbox to set the target (turns orange).
3. Click **Compare selected** in the toolbar.

The diff modal renders a structural per-entry table:

| Type      | Meaning                                                      |
|-----------|--------------------------------------------------------------|
| added     | Page or question present in target, missing in base.         |
| removed   | Page or question removed in target.                          |
| modified  | Same question name, but title / type / required / choices / other fields differ. |
| moved     | Same question name, different position.                      |
| setting   | Top-level survey setting changed (title, theme, locale, …). Old / new value shown inline. |

Each row carries a stable path like `pages[0].elements[2]` for easy
cross-referencing with the JSON editor in the Designer.

### Change-count semantics

The Designer's "N unpublished changes" badge and the comparison modal
use the **same diff engine** (`frontend/src/admin/definitionDiff.ts`).
A question reorder counts once as a `moved` entry — not once per
position — so renumbering ten questions does not inflate the count
to ten.

---

## 5. Restore a previous version

1. Open the **Versions** tab.
2. Click **Restore** on any non-current row.
3. The confirmation modal explains that restore is **non-destructive**:
   - The current published revision stays in the history.
   - A new revision is created whose definition matches the one you
     are restoring.
   - Existing responses keep pointing to the revision they were
     collected against, so already-collected answers are not lost.
4. Click **Restore as new revision** (orange button) to confirm.

The plugin creates a new `survey_versions` row, flips
`surveys.id_current_survey_versions` to point at it, and emits a
Mercure invalidation so any live `surveyjs` style picks up the change
on the next request.

---

## 6. Embed a survey in a CMS page

The plugin contributes a **`surveyjs`** style. To embed a survey:

1. Open **Admin → Pages → \<your-page\> → Sections**.
2. Add a new section of style **`surveyjs`**.
3. Set the section's fields:
   - **Survey** — pick the survey by key slug (dropdown is populated
     from `surveys.survey_id`).
   - **Mode** — `interactive` (default) or `readonly`.
   - **Submit redirect** — optional path to redirect to on submit.
   - **Save partial answers** — if true, the runtime POSTs partial
     state on every page change (Mercure-broadcast for resume).
4. Save the section.

The frontend renderer downloads the version pointed to by
`surveys.id_current_survey_versions`, mounts `survey-react-ui`, and
posts every answer through the host's `dataTables` write API. No
host-frontend code changes are required.

---

## 7. Configure survey-style parameters

The `surveyjs` style exposes the following fields. All are stored on
the section, so different pages can pin different parameters.

| Field                 | Default     | Effect                                                          |
|-----------------------|-------------|-----------------------------------------------------------------|
| `surveyKeySlug`       | _required_  | Which survey to render.                                          |
| `mode`                | `interactive` | `readonly` mounts the renderer in display-only mode.            |
| `themeCode`           | `default`   | Overrides `surveys.theme_code` for this section only.            |
| `savePartialAnswers`  | `false`     | POST progress after each page change.                            |
| `redirectOnSubmit`    | _empty_     | Absolute / relative URL; empty means stay on the same page.      |
| `showProgressBar`     | `auto`      | `off` / `auto` / `top` / `bottom`.                               |
| `richTextEditor`      | `false`     | Forces rich-text editing for editable fields in the runtime UI.  |
| `cssVariables`        | _empty_     | JSON map of CSS custom properties to inject (per-section themes).|
| `analyticsTopicKey`   | _empty_     | Per-section Mercure topic suffix for "answered" events.           |

When a field is left empty, the plugin falls back to the survey-level
default (theme, rich-text) or the global default (mode).

---

## 8. Collect responses

Responses live in two places:

1. **`survey_runs`** — one row per respondent submission (generated
   `response_id`, status, `id_users`, `id_data_rows`,
   started/completed timestamps, `progress` JSON for partial answers).
2. **`survey_answer_links`** — one row per (run, question), linked to
   the host's `data_cells` so the same answer is visible in the host's
   Data Browser.

The plugin's **Responses** tab on the survey detail page paginates
through both tables, joining them so admins see the friendly
question label rather than the raw `data_cells` row id.

Per-response actions:

- **Export PDF** — requires `surveyjs.surveys.export-pdf`.
- **Hard-delete** — only allowed when GDPR erasure is requested;
  drops the `survey_runs` row, its links, and the underlying
  `data_rows` / `data_cells` rows in one transaction.

---

## 9. Display responses on a page

The plugin contributes a second style: **`surveyjsAnswers`**, which
renders a respondent's own answers (or, with the
`surveyjs.surveys.view-responses` permission, every response). Drop
it on any page to give respondents a "Here's what you answered"
view.

Common fields:

| Field             | Effect                                              |
|-------------------|-----------------------------------------------------|
| `surveyKeySlug`   | Which survey to summarize.                          |
| `scope`           | `self` (default) / `all` (admin only).               |
| `groupByQuestion` | `true` shows per-question aggregates.                |
| `chartTypes`      | JSON map of question name → `bar`/`pie`/`heatmap`.   |

---

## 10. Permissions reference

The plugin seeds three permissions in its install migration:

| Permission                          | Granted via roles                |
|-------------------------------------|----------------------------------|
| `surveyjs.surveys.manage`           | Survey authors / admins          |
| `surveyjs.surveys.view-responses`   | Researchers / data analysts      |
| `surveyjs.surveys.export-pdf`       | Researchers (optional)           |

Bind them through the host's **Admin → User Management → Roles**
page. The plugin's UI gates every action on these — for example, the
**Versions → Make current** button only shows when the user has
`surveyjs.surveys.manage`.

---

## 11. Mobile experience

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

## 12. Troubleshooting

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

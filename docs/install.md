<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# Installing the SurveyJS plugin (`sh2-shp-survey-js`)

This is the **simplest possible** guide. Pick **one** of the three options below.

You **don't** need to restart the backend or rebuild the frontend by hand — every option does that for you automatically once the plugin lands in the database.

| You want to…                                              | Use this option                              |
| --------------------------------------------------------- | -------------------------------------------- |
| Install from the official plugin library (public registry) | **Option 1** — UI → Available tab            |
| Install your own local copy that lives on disk             | **Option 2** — UI → Install plugin button    |
| Install from a terminal in one command                     | **Option 3** — One-shot script               |

> The plugin is currently at version **0.1.0** (pre-release).

---

## Before you start

Make sure these are running locally **once**:

1. The host backend dev server (`composer dev` from `sh-selfhelp_backend`).
2. The host frontend dev server (`npm run dev` from `sh-selfhelp_frontend`).
3. You are logged in as an **admin** in the frontend at `http://localhost:3000/admin`.
4. The plugin checkout exists somewhere on your machine, e.g. `D:\TPF\SelfHelp\plugins\sh2-shp-survey-js`.

That's it. The three options below assume this baseline.

---

## Option 1 — Install from the official registry (UI)

Recommended for production hosts. Every SelfHelp instance already
ships with the official Humdek registry seeded as a system source
called `humdek-public` pointing at
<https://humdek-unibe-ch.github.io/sh2-plugin-registry/>. You do not
have to add it manually.

**Steps:**

1. Go to `http://localhost:3000/admin/plugins`.
2. Click the **Available** tab. Plugins advertised by the registry
   appear in the table.
3. Click **Install** on the SurveyJS row.

That's it. The host:

- creates a staged install operation,
- runs the installer (it reads the registry's manifest, validates
  it, runs the plugin migrations, registers permissions, styles,
  admin pages, lookups, feature flags),
- enables the plugin (the **Enable plugin after install** switch is
  on by default),
- emits a Mercure event so the admin UI refreshes — no page reload
  required.

You can now create surveys at `Admin → Surveys` (see
[`docs/user-guide.md`](user-guide.md)).

### Optional — adding additional plugin sources

If your team runs an internal staging registry, a private mirror,
or wants to install a plugin from disk during development, add a new
source under **Admin → Plugins → Sources → Add source**. The seeded
`humdek-public` row stays read-only and the host will merge entries
from every enabled source in the **Available** tab.

| Kind                  | URL example                                                        | Auth fields                                   |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Public registry       | `https://<your-org>.github.io/<your-registry>/`                    | leave empty                                   |
| Private registry      | `https://registry.<your-org>.<tld>/`                               | header name + env var name (token in env var) |
| Git                   | `https://github.com/<owner>/<repo>.git`                            | leave empty (use SSH keys server-side)        |
| Local                 | `D:\plugins\my-staging-registry`                                   | leave empty                                   |

See [`publish.md`](publish.md) for the details of how the registry
files are laid out and how to publish to the official Humdek
registry.

---

## Option 2 — Install from a local `plugin.json` (UI, no registry)

Recommended when the plugin lives on your laptop and is **not yet published**.

The Install modal offers three ways to load the manifest, pick
whichever is fastest:

- **Drag & drop**: drop the plugin's `plugin.json` file directly on
  the dotted upload area at the top of the modal.
- **Choose file**: click the **Choose file…** button above the
  editor to open the native file picker.
- **Paste JSON**: paste the manifest into the embedded Monaco
  editor. Inline JSON validation flags syntax errors immediately.

**Steps:**

1. Go to `http://localhost:3000/admin/plugins`.
2. Click **Install plugin** in the top right.
3. Load the manifest using one of the three options above. The
   plugin's `plugin.json` lives at
   `<your-workspace>/plugins/sh2-shp-survey-js/plugin.json`.
4. Leave **Enable plugin after install** on.
5. Click **Request install**, then **Finalize**.

Done. The host runs the same install flow as Option 1 in development mode (immediate, in-process).

> **Note (local-only):** the UI flow above stages the install but does **not** itself add the plugin's PHP/Node packages to the host. For pure local development we recommend Option 3 — it is the same install command but it also wires up Composer and npm so the host can `import` / `use` the plugin code immediately.

---

## Option 3 — One-shot install from the terminal

Recommended for **anyone working on the plugin locally** because it handles the package wiring for you too.

This uses the included `scripts/install-local.ps1` / `scripts/install-local.sh`. The script:

1. Adds a Composer **path repository** to the host backend so PHP `vendor/` resolves to the plugin's `backend/` folder.
2. Runs `composer require humdek/sh2-shp-survey-js:@dev` in the host backend.
3. Calls `php bin/console selfhelp:plugin:install <path>/plugin.json` — the same command Options 1 and 2 trigger from the UI.
4. Runs `npm install + build + npm link` in the plugin's `frontend/` and `mobile/` packages so the host frontend and mobile checkouts resolve them locally (no registry round-trip).

### Windows (PowerShell)

```powershell
cd plugins\sh2-shp-survey-js
.\scripts\install-local.ps1
```

### macOS / Linux / WSL

```bash
cd plugins/sh2-shp-survey-js
./scripts/install-local.sh
```

### What if the host repos are somewhere else?

Pass absolute paths to the script:

```powershell
.\scripts\install-local.ps1 `
    -BackendPath  'D:\projects\sh-selfhelp_backend' `
    -FrontendPath 'D:\projects\sh-selfhelp_frontend' `
    -MobilePath   ''
```

```bash
./scripts/install-local.sh \
    --backend  /home/me/sh-selfhelp_backend \
    --frontend /home/me/sh-selfhelp_frontend \
    --mobile   ''   # empty string = skip mobile linking
```

### What gets reloaded automatically?

| Layer    | How it picks up the change                                                   |
| -------- | ---------------------------------------------------------------------------- |
| Backend  | Symfony auto-reloads `config/selfhelp_plugin_bundles.php` on the next request |
| Frontend | Next.js HMR picks up the npm link instantly; a hard refresh of `/admin` is enough |
| Mobile   | Press `r` in the Metro/Expo terminal to reload                                |

You should **not** need to manually `composer dump-autoload`, `php bin/console cache:clear`, or `npm run build` in the host repos — the install command already does that for you.

---

## Verifying the install

Open `http://localhost:3000/admin/plugins`. You should see:

- A row with **SurveyJS** version `0.1.0` in the **Installed** tab.
- Status = `enabled`.
- Compatibility = `ok`.

Open `http://localhost:3000/admin/surveys` and you should see the Survey Designer.

If anything is wrong, run the doctor command from the backend folder:

```bash
php bin/console selfhelp:plugin:doctor
```

It checks: lock-file parity, Composer/npm package presence, Mercure reachability, and each plugin's own health endpoint.

---

## Troubleshooting

| Problem                                                          | Fix                                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **"Composer not found"** when running `install-local`            | Either install Composer 2 globally or pass `-SkipComposer` / `--skip-composer` to the script.   |
| **Frontend tab still shows the plugin as missing**                | Hard-refresh the admin page (`Ctrl+Shift+R`). The Next.js dev server picks up `npm link` instantly but the browser may have cached the old bundle. |
| **Backend says "Class … not found"** after install               | Restart the Symfony dev server once so the Composer autoloader regenerates.                     |
| **Available tab is empty even though a Source is configured**     | Verify the registry's `<URL>/registry.json` endpoint returns valid JSON. The "Available" tab calls `GET /cms-api/v1/admin/plugins/available` which walks every enabled Source. |
| **Doctor reports `npm_package_not_installed`**                    | The host frontend `node_modules` does not contain the plugin yet. Run `npm install` in `sh-selfhelp_frontend` OR re-run the Option 3 script so it re-links. |
| **Admin → Plugins page shows "Plugins" but no data**             | The current user is missing the `admin.plugins.manage` permission. Add it to the admin role.   |

---

## What gets installed?

When the install completes, the host writes the following:

- **Database**: 4 plugin-owned tables (`surveys`, `survey_versions`, `survey_runs`, `survey_answer_links`) and 9 plugin-owned `data_tables` prefixed with `sh2_surveyjs_`.
- **Permissions**: `surveyjs.surveys.manage`, `surveyjs.surveys.view-responses`, `surveyjs.surveys.export-pdf` (assigned to admin role by default).
- **Lookups**: `surveyJsTheme` (default / modern / high-contrast).
- **Styles**: `surveyjs`, `gpxMap` (available in the page builder).
- **Admin pages**: `Surveys`, `Survey Designer`, `Responses`, `Dashboard`, `Settings`.
- **API routes**: 10 routes under `/cms-api/v1/admin/plugins/surveyjs/*` and `/cms-api/v1/plugins/surveyjs/*`.
- **Feature flags**: `gpx`, `video`, `rich-text`, `pdf-export`, `dashboard`, `collab-editing`.
- **Symfony bundle**: `Humdek\SurveyJsBundle\HumdekSurveyJsBundle` (added to `config/selfhelp_plugin_bundles.php`).
- **Lock file**: a new entry in `selfhelp.plugins.lock.json` so the install is reproducible.

If you uninstall the plugin from the same UI, every item above is reversed cleanly. Use **Purge** (red button) only if you also want the plugin-owned tables dropped — purges are destructive and ask for typed confirmation.

---

## Next steps

- [User guide for survey authors](user-guide.md)
- [Mobile experience guide](mobile-guide.md)
- [How to publish this plugin so others can install via Option 1](publish.md)
- [Plugin architecture overview (host repo)](../../sh-selfhelp_backend/docs/plugins/architecture.md) — only if you want to understand what the host runs under the hood.

<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# Installing the SurveyJS plugin (`sh2-shp-survey-js`)

This is the **simplest possible** guide. Pick **one** of the three options below.

You **don't** need to restart the backend or rebuild the frontend by hand — every option does that for you automatically once the plugin lands in the database.

| You want to…                                              | Use this option                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Install from the official plugin library (public registry) | **Option 1** — UI → Available tab                                |
| Install your own local copy that lives on disk             | **Option 2** — UI → Install plugin button                        |
| Install from a terminal in one command                     | **Option 3** — `node scripts/install-local.mjs` (every OS)       |

> The plugin is currently at version **0.2.2** (pre-release).

### Install vs Enable

The host treats install and enable as two distinct lifecycle steps:

- **Install** runs the migration, registers permissions/styles/lookups/api_routes, writes the `plugins` row, and stops. The plugin is in the database but **inactive** — its admin pages, menu items, and styles do not load yet.
- **Enable** flips `plugins.enabled = 1`, invalidates the relevant Redis caches, regenerates `config/selfhelp_plugin_bundles.php`, and publishes a Mercure event so the admin UI refreshes without a page reload.

Why the split? Because production hosts run an admin review between the two steps — trust level, capabilities, permissions, and external hosts are all things a security-minded admin will want to inspect on the **Installed** tab before turning the plugin on. The UI **Install plugin** modal has an *Enable plugin after install* switch that defaults to ON for convenience; tick it off to install without enabling.

The development workflow (Option 3 with `--symlink`) already runs `php bin/console selfhelp:plugin:enable <plugin-id>` for you, so a fresh checkout shows the plugin in the side menu immediately.

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

This uses the included `scripts/install-local.mjs` — a single Node
script that runs on PowerShell, Git Bash, WSL, macOS, and Linux. There
is no `.ps1` / `.sh` split.

### What the script does

By default (`.shplugin` upload mode):

1. Builds the signed `.shplugin` via `node scripts/build-shplugin.mjs`.
2. Uploads the `.shplugin` to the local host's
   `/cms-api/v1/admin/plugins/install` endpoint.
3. Drains the `plugin_ops` Messenger queue inline
   (`php bin/console messenger:consume plugin_ops --limit=1
   --time-limit=120`) so the install is finalised before the script
   exits.

With `--symlink` (dev fast-path):

1. Writes a temporary development `plugin.json` whose
   `backend.composer.repository` points at this checkout's `backend/`
   folder.
2. Calls `php bin/console selfhelp:plugin:install <temp>/plugin.json`
   or `selfhelp:plugin:update` if the plugin is already installed.
3. Drains the Messenger queue. The host worker installs the backend
   package into `var/plugin-composer/`, not the host root Composer
   project.
4. Enables the plugin.
5. Prints the runtime dev-server command.

The dev fast-path deliberately does **not** edit
`sh-selfhelp_backend/composer.json`, `composer.lock`, `symfony.lock`, or
`config/bundles.php`. Those files are release-critical host files and
must not receive local plugin path repositories.

### Quick start (every OS)

```bash
cd plugins/sh2-shp-survey-js

# 1. Copy the env defaults (admin token, signing key, paths).
cp .env.example .env
# Edit .env and set at least:
#   SELFHELP_ADMIN_TOKEN=<paste an admin JWT>
#   SELFHELP_PLUGIN_DEV_SIGNING_KEY=<base64 from sign.mjs keygen>

# 2. Default flow — .shplugin upload + queue drain:
node scripts/install-local.mjs

# Or, the dev fast-path that uses the isolated plugin Composer root:
node scripts/install-local.mjs --symlink

# Keep this running while editing the plugin UI:
npm --prefix frontend run dev:runtime
```

`SELFHELP_ADMIN_TOKEN` can also be passed via `--token <jwt>`; real
process-env values always override `.env`.

### What if the host repos are somewhere else?

```bash
node scripts/install-local.mjs \
    --backend "/abs/path/to/sh-selfhelp_backend" \
    --api-base "http://localhost:8000"
```

Equivalents in `.env`:

```dotenv
SELFHELP_BACKEND_PATH=/abs/path/to/sh-selfhelp_backend
SELFHELP_API_BASE=http://localhost:8000
```

### Useful flags

| Flag                  | Effect                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `--symlink`           | Skip the upload, attach the local backend through the isolated plugin Composer root, and invoke the CLI installer/updater. |
| `--skip-build`        | Skip the `npm run build:runtime` step inside `build-shplugin.mjs`.         |
| `--skip-consume`      | Skip `messenger:consume`. Useful if a long-running worker is already up.   |
| `--token <jwt>`       | Admin JWT (overrides `SELFHELP_ADMIN_TOKEN`).                              |
| `--api-base <url>`    | Local host base URL (default `http://localhost:8000`).                     |
| `--backend <path>`    | Path to the `sh-selfhelp_backend` checkout.                                |
| `-h`, `--help`        | Print usage.                                                               |

### What gets reloaded automatically?

| Layer    | How it picks up the change                                                   |
| -------- | ---------------------------------------------------------------------------- |
| Backend  | `--symlink` registers the bundle/routes/tables once through `var/plugin-composer`; restart only after backend PHP changes that affect boot-time services |
| Frontend | `npm --prefix frontend run dev:runtime` serves the Vite watch build and emits reload events consumed by the host PluginRuntime |
| Mobile   | Press `r` in the Metro/Expo terminal to reload                                |

After the one-time attach you should **not** need to rebuild an archive,
reinstall the plugin, or restart the host frontend for normal SurveyJS
admin UI edits. The browser imports
`http://localhost:5174/sh2-shp-survey-js/plugin.esm.js` and reloads it
when the plugin dev runtime emits a change event.

---

## Air-gapped / restricted-network installs (standalone `.shplugin`)

If the target host cannot reach Packagist for the plugin itself
(corporate firewall, vendored deployment snapshot, offline-first
demo), build the `.shplugin` in **standalone** mode. The archive
then carries the plugin's backend Composer package inside it.

```bash
cd plugins/sh2-shp-survey-js
node scripts/build-shplugin.mjs --mode standalone
# → dist/sh2-shp-survey-js-<ver>.shplugin
```

What changes compared to the default connected archive:

- The `.shplugin` includes `backend/package/` with `composer.json`,
  `src/`, `config/`, and `migrations/` (the same files Packagist
  would serve for the plugin).
- The host install pipeline registers a Composer **path repository**
  pointing at the promoted backend dir and runs `composer require`
  from there — Packagist is **not** consulted for the plugin itself.
- The admin upload preview shows two extra badges next to the
  signature status:
  - `archive: standalone` (vs `archive: connected`),
  - `backend included` (tooltip lists the bundled package + version).
- Third-party PHP deps (symfony/*, doctrine/*, …) are still
  resolved by Composer at install time. Standalone mode does **not**
  bundle `vendor/`. For fully air-gapped hosts you still need a
  Packagist mirror or a pre-populated `vendor/` directory.

Upload the standalone `.shplugin` through the same admin UI path as
any other archive (**Plugins → Install plugin → Upload .shplugin**),
or POST it from the CLI:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $SELFHELP_ADMIN_TOKEN" \
  -F "source=archive" \
  -F "archive=@dist/sh2-shp-survey-js-<ver>.shplugin" \
  "$HOST/cms-api/v1/admin/plugins/install"
```

> **Why standalone keeps internet required for third-party deps:**
> bundling `vendor/` would 5–10× the archive size and pin the host
> to the publisher's exact Symfony/Doctrine versions. Operators on
> air-gapped hosts must arrange for a Packagist mirror or a
> pre-populated `vendor/` directory instead.

---

## Verifying the install

Open `http://localhost:3000/admin/plugins`. You should see:

- A row with **SurveyJS** version `0.2.2` in the **Installed** tab.
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
| **"Composer not found"** during queue drain                        | Install Composer 2 globally; the host Messenger worker uses Composer inside `var/plugin-composer/`. |
| **"1 plugin could not be mounted — Plugin package import failed"** | The host stored a dev runtime URL (`http://localhost:5174/sh2-shp-survey-js/plugin.esm.js`) but the dev server is down. Start `npm --prefix frontend run dev:runtime`, wait for the first `built in <Ns>` line, then hard-refresh the admin page (`Ctrl+Shift+R`). |
| **"Expected v\<version\>"** in the mount-failure banner            | The host already knows the plugin; the loaded ESM bundle just hasn't reported its version yet (because it never loaded). The expected value comes from `plugins.version` in the host DB, captured at install time from `plugin.json#version`. Fix the import failure above and the banner clears. Bumping `plugin.json#version` without re-running `install-local.mjs` is the only way to make the two numbers diverge intentionally. |
| **Frontend tab still shows the plugin as missing**                | Start `npm --prefix frontend run dev:runtime`, verify `http://localhost:5174/sh2-shp-survey-js/plugin.esm.js` loads, then hard-refresh the admin page (`Ctrl+Shift+R`). |
| **Backend says "Class … not found"** after install               | Restart the Symfony dev server once so the Composer autoloader regenerates.                     |
| **Available tab is empty even though a Source is configured**     | Verify the registry's `<URL>/registry.json` endpoint returns valid JSON. The "Available" tab calls `GET /cms-api/v1/admin/plugins/available` which walks every enabled Source. |
| **Doctor reports the plugin backend package is missing**           | Re-run `node scripts/install-local.mjs --symlink` and drain the `plugin_ops` queue so `var/plugin-composer/` is rebuilt. |
| **Admin → Plugins page shows "Plugins" but no data**             | The current user is missing the `admin.plugins.manage` permission. Add it to the admin role.   |
| **Install succeeded but the SurveyJS menu/UI is missing**         | Default upload mode (Options 1, 2) does **not** auto-enable — open `Admin → Plugins → Installed` and click **Enable** on the SurveyJS row. The `--symlink` flow used by Option 3 already enables the plugin for you. The host invalidates the relevant Redis categories and publishes a Mercure event on enable so the UI refreshes automatically. |

---

## What gets installed?

When the install completes, the host writes the following:

- **Database**: 6 plugin-owned tables (`surveys`, `survey_versions`, `survey_runs`, `survey_answer_links`, `survey_response_drafts`, `survey_files`). `surveys.survey_id` and `survey_runs.response_id` are generated stable keys. Runtime submissions create plugin-owned host `data_tables` on demand with the `sh2_surveyjs_` prefix.
- **Permissions**: `surveyjs.surveys.{manage, view-responses, export-pdf, delete-responses, export-csv, export-xlsx, export-json, upload-files}` — all linked to the `admin` role by the plugin's migration so administrators get the full surface out of the box.
- **Lookups**: `surveyJsTheme` (default / modern / high-contrast).
- **Styles**: `surveyjs`, `gpxMap` (available in the page builder).
- **Admin pages**: `Surveys`, `Survey Designer`, `Responses`, `Dashboard`, `Settings`.
- **API routes**: 31 routes under `/cms-api/v1/admin/plugins/sh2-shp-survey-js/*` and `/cms-api/v1/plugins/sh2-shp-survey-js/*`. The host's `PluginApiRouteSynchronizer` reads `plugin.json#apiRoutes` and persists each entry as a row in `api_routes` (tagged with `id_plugins`) linked to its permissions through `rel_api_routes_permissions`.
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

# sh2-shp-survey-js

SurveyJS v2 plugin for the SelfHelp CMS. Provides:

- A Mantine-themed Survey Creator for admins (`survey-creator-react`).
- A runtime SurveyJS style for the frontend (`survey-react-ui`).
- Optional custom question types: GPX (Leaflet map preview), Video, and Tiptap rich-text.
- A standalone `gpxMap` style for rendering a GPX answer field on its own page.
- A readonly mobile renderer with an "Open on web" fallback for unsupported question types.
- A response dashboard, response list, PDF export, and collaborative-edit notifications via Mercure.

> **Looking for end-user documentation?**
> - **[Install guide](./docs/operations/install.md) — start here.** Three ways to install (two UI flows + one terminal one-liner).
> - [Publish guide](./docs/operations/publish.md) — how to publish the plugin so others can install it from the UI.
> - [User guide](./docs/user/user-guide.md) — create surveys, publish, restore versions, embed, configure.
> - [Mobile guide](./docs/user/mobile-guide.md) — what the mobile renderer does and does not support today.
> - [Architecture](./docs/developer/architecture.md) — internals, services, schema, security.
> - [Manifest reference](./docs/reference/manifest.md) — the exact `plugin.json` contract.
> - [Docs index](./docs/README.md) — the full audience-based documentation map.

Submissions land in the existing `data_tables` / `data_rows` / `data_cols` / `data_cells` tables, normalized by `SurveyAnswerNormalizer`. HTML answers go through `SurveyJsHtmlSanitizer` before storage. The plugin owns six entities — `surveys`, `survey_versions`, `survey_runs`, `survey_answer_links`, `survey_files`, `survey_response_drafts` — for surveys, version snapshots, response metadata, per-question links into form storage, uploaded files, and in-progress drafts. Surveys and responses also get generated stable keys (`survey_id` / `response_id`) for external references.

## Develop locally in 60 seconds

Two terminals from this plugin checkout:

```bash
# Terminal 1 — install + auto-enable into the local host (one-time per checkout).
# Runs the same Messenger pipeline as production but in DEVELOPMENT install mode,
# attaches the plugin through the isolated plugin Composer root
# (`var/plugin-composer/`), and finishes with `selfhelp:plugin:enable`.
node scripts/install-local.mjs --symlink

# Terminal 2 — keep the runtime dev server running. This is what
# the host frontend imports while you edit the plugin UI. If this
# server is not running the host shows
# "Plugin package import failed — http://localhost:5174/... failed".
npm --prefix frontend run dev:runtime
```

Then open `http://localhost:3000/admin/plugins` and `http://localhost:3000/admin/surveys`. Plugin UI edits hot-reload through the dev server's SSE channel; backend edits require restarting the Symfony dev server. See [`docs/install.md`](./docs/operations/install.md#option-3--one-shot-install-from-the-terminal) for the full reference (every flag, every mode, every troubleshooting hint).

### "Plugin could not be mounted — Expected v0.2.2"

This is the host runtime telling you it knows about the plugin (the database row was created by `install-local.mjs --symlink`) but could not load the JS bundle from `http://localhost:5174/sh2-shp-survey-js/plugin.esm.js`. Three things to check, in order:

1. **Is `npm --prefix frontend run dev:runtime` running in another terminal?** That command serves the URL above. If you closed the terminal, the import 404s.
2. **Did the first Vite watch build finish?** Wait until you see `built in <Ns>` in the dev-runtime output before reloading the host page.
3. **If the dev server was already running before you pulled changes, restart it once.** The runtime bundle imports the host's `/api/plugins/runtime-shim/*` modules; `scripts/dev-runtime.mjs` proxies those through `localhost:5174`, so an old process can still be serving the pre-fix behavior even while the URL itself returns `200`.
4. **The "Expected v0.2.2" string is read from the host's database** (`plugins.version` column, set when you ran `install-local.mjs` from this plugin's `plugin.json`). The host returns it through `GET /cms-api/v1/plugins/manifest`; the host frontend then compares it against `registration.version` from the loaded ESM bundle. Bump `plugin.json#version` AND re-run `install-local.mjs --symlink` together, otherwise the two numbers go out of sync.

The full chain is documented in the host repo: [`docs/plugins/installation.md` §6.2](../../sh-selfhelp_backend/docs/plugins/installation.md#62-troubleshooting-plugin-could-not-be-mounted).

## Repository layout

```
sh2-shp-survey-js/
├── plugin.json                      Manifest (validated against the host schema)
├── composer.json                    Composer package root for connected installs
├── AGENTS.md
├── README.md
├── CHANGELOG.md
├── docs/                            Plugin-specific docs
├── backend/                         Symfony bundle source tree
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
└── mobile/                          npm package (@selfhelp/sh2-shp-survey-js-mobile, WebView renderer)
    ├── package.json
    ├── src/index.ts                 Exports `registerMobile`
    ├── src/styles/                  RN shell + native/web WebView transports
    ├── src/runtime/                 DOM-free SurveyJS lifecycle controller + helpers
    └── src/webview/                 self-contained SurveyJS WebView runtime (built)
```

## Installation — pick one

See [`docs/install.md`](./docs/operations/install.md) for the full guide. The TL;DR is:

| Option | Where    | Command                                                                                |
| ------ | -------- | -------------------------------------------------------------------------------------- |
| 1      | Admin UI | Plugins → **Available** → Install (uses the seeded `humdek-public` registry)           |
| 2      | Admin UI | Plugins → **Install plugin** → drag the `.shplugin` from the latest GitHub Release     |
| 3      | Admin UI | Plugins → **Install plugin** → paste `plugin.json`                                     |
| 4      | Terminal | `node scripts/install-local.mjs` — single cross-platform installer (PowerShell / Git Bash / WSL / macOS / Linux) |

> Option 4 is a single Node script. Same command on every OS — no
> `.ps1` / `.sh` split. Runs `node scripts/build-shplugin.mjs` to
> build the signed `.shplugin`, uploads it to the local host's
> `/cms-api/v1/admin/plugins/install` endpoint, and drains
> `messenger:consume plugin_ops` inline.

Option 4 also wires the local Composer / npm path repo (`--symlink`)
to this repo root, so the host resolves the backend package via the
root `composer.json` while the frontend keeps hot-reloading from the
runtime dev server. See
[`docs/install.md`](./docs/operations/install.md#option-4--one-shot-install-from-the-terminal)
for `--symlink` details.

## Build the `.shplugin`

The `.shplugin` is a signed, checksummed ZIP that contains everything
a SelfHelp host needs to install the plugin: the manifest, the
runtime ESM bundle, the optional stylesheet, the SHA256 sums, and an
Ed25519 signature over the canonical payload.

Every script in `scripts/` is a single cross-platform Node script
(`.mjs`). The same command works on PowerShell, Git Bash, WSL, macOS
and Linux — there are no `.ps1` / `.sh` wrappers.

Build locally:

```bash
# 1. Generate a dev keypair once (sibling registry checkout required).
git clone https://github.com/humdek-unibe-ch/sh2-plugin-registry ../sh2-plugin-registry
node ../sh2-plugin-registry/scripts/sign.mjs keygen
#   → copy "privateKey" into .env (see step 2)
#   → copy "publicKey"  into the host's SELFHELP_PLUGIN_TRUSTED_KEYS

# 2. Drop the keypair (and any of the other defaults) into a local
#    .env file — gitignored. Auto-loaded by every scripts/*.mjs.
cp .env.example .env
# Edit .env and set:
#   SELFHELP_PLUGIN_DEV_SIGNING_KEY=<base64-private-key>

# 3. Build the archive.
node scripts/build-shplugin.mjs
# Standalone version
node scripts/build-shplugin.mjs --mode standalone
# → dist/sh2-shp-survey-js-<version>.shplugin
```

`SELFHELP_PLUGIN_*_SIGNING_KEY` can also be set as a normal shell env
variable; real `process.env` values always win over `.env`. CI just
injects them as Actions secrets — see [`docs/secrets-setup.md`](./docs/operations/secrets-setup.md).

The script:

1. Auto-loads `<plugin-root>/.env` via Node 22's `process.loadEnvFile`.
2. Auto-installs `frontend/node_modules` if `vite` is missing.
3. Runs `vite build` for the frontend runtime.
4. Stages `plugin.json` + `artifacts/{plugin.esm.js,SHA256SUMS}` plus
   `artifacts/plugin.css` **only if** the Vite build emitted one.
   CSS is optional; the canonical signed payload (and the host
   validator) mirror that.
5. Builds the canonical signed payload via the shared `sign.mjs`.
6. Signs with `SELFHELP_SIGNING_KEY` (or
   `SELFHELP_PLUGIN_DEV_SIGNING_KEY` → keyId `dev`, dev-only).
7. Writes SHA256SUMS with archive-root-relative paths
   (`<hash>  artifacts/<file>`) — the host's `PluginArchiveValidator`
   refuses anything else.
8. Writes a deterministic, forward-slash ZIP via a built-in
   pure-Node writer (no `zip` / `Compress-Archive` dependency).
9. Self-validates by re-reading the SHA256SUMS.

Use the dev-signed archive for `Admin → Plugins → Install plugin →
Upload .shplugin` on a local host. The host accepts `keyId="dev"` on
this plugin's `official` trust level **only when `APP_ENV=dev`** AND
the matching public key is registered in
`SELFHELP_PLUGIN_TRUSTED_KEYS`:

```bash
# In sh-selfhelp_backend/.env.local — public half of the keypair you
# used as SELFHELP_PLUGIN_DEV_SIGNING_KEY at build time:
SELFHELP_PLUGIN_TRUSTED_KEYS=dev=<base64-public-key>
```

Production hosts (`APP_ENV=prod`) refuse `keyId="dev"` outright for
`official`/`reviewed` trust levels regardless of trusted-keys —
use a real CI keypair via `SELFHELP_SIGNING_KEY` +
`SELFHELP_SIGNING_KEY_ID`. See
[`docs/secrets-setup.md`](./docs/operations/secrets-setup.md) and
[`docs/publish.md`](./docs/operations/publish.md).

## Publish a new version (automated)

The full publish pipeline is automated through GitHub Actions. To
release a new version:

```bash
# 1. Bump version in plugin.json + add a CHANGELOG entry under
#    "## [<version>] — YYYY-MM-DD".
# 2. Commit and tag.
git add plugin.json CHANGELOG.md
git commit -m "chore: release v<version>"
git tag v<version>
git push origin main --tags
```

On every `v*` tag push the
[`.github/workflows/publish-to-registry.yml`](.github/workflows/publish-to-registry.yml)
workflow:

1. Validates `plugin.json` against the canonical host schema.
2. Builds the frontend runtime + the signed `.shplugin`.
3. Copies the manifest to
   `humdek-unibe-ch/sh2-plugin-registry/manifests/<id>-<version>.json`,
   uploads the runtime artefacts to
   `humdek-unibe-ch/sh2-plugin-registry/artifacts/<id>-<version>/`,
   updates the canonical `registry.json` (sorted, latest per
   `(id, channel)`), and commits the change.
4. Creates a GitHub Release on this repo with:
   - the per-version section of `CHANGELOG.md` as the body,
   - the `.shplugin` attached as an asset (so admins can drag-and-drop
     install it without an internet round-trip to the registry).
5. The registry repo's own
   [`build-registry.yml`](https://github.com/humdek-unibe-ch/sh2-plugin-registry/blob/main/.github/workflows/build-registry.yml)
   workflow re-validates + republishes the static site so every
   SelfHelp host with the `humdek-public` source enabled picks the
   new version up on the next refresh of the **Available** tab.

Required GitHub Actions secrets (Settings → Secrets and variables →
Actions):

| Secret                            | Used for                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SELFHELP_SIGNING_KEY`     | Ed25519 base64 secret key. Used to sign the canonical payload.                                  |
| `SELFHELP_SIGNING_KEY_ID`  | Publisher key id. Must match an entry in the host's `SELFHELP_PLUGIN_TRUSTED_KEYS`.             |
| `REGISTRY_PUSH_TOKEN`             | PAT with `contents:write` on `humdek-unibe-ch/sh2-plugin-registry`. Missing → dry-run mode.     |

Step-by-step walkthrough including key generation, GitHub UI
clicks, and where to paste the public key on the host:
**[`docs/secrets-setup.md`](./docs/operations/secrets-setup.md)**.

Without `REGISTRY_PUSH_TOKEN` the workflow still builds the
`.shplugin` and attaches it to the GitHub Release; only the
registry-side push is skipped (the workflow logs a warning summary).

Full publish reference: [`docs/publish.md`](./docs/operations/publish.md).

For `archive.mode="connected"` releases, the plugin registry still
publishes only discovery metadata plus frontend artifacts. The PHP
bundle is installed separately by Composer from this repo's root
`composer.json` (or another Composer source declared in
`plugin.json#backend.composer.repository`).

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

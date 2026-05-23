# sh2-shp-survey-js

SurveyJS v2 plugin for the SelfHelp CMS. Provides:

- A Mantine-themed Survey Creator for admins (`survey-creator-react`).
- A runtime SurveyJS style for the frontend (`survey-react-ui`).
- Optional custom question types: GPX (Leaflet map preview), Video, and Tiptap rich-text.
- A standalone `gpxMap` style for rendering a GPX answer field on its own page.
- A readonly mobile renderer with an "Open on web" fallback for unsupported question types.
- A response dashboard, response list, PDF export, and collaborative-edit notifications via Mercure.

> **Looking for end-user documentation?**
> - **[Install guide](docs/install.md) — start here.** Three ways to install (two UI flows + one terminal one-liner).
> - [Publish guide](docs/publish.md) — how to publish the plugin so others can install it from the UI.
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

## Installation — pick one

See [`docs/install.md`](docs/install.md) for the full guide. The TL;DR is:

| Option | Where         | Command                                        |
| ------ | ------------- | ---------------------------------------------- |
| 1      | Admin UI      | Plugins → **Sources** → add registry → **Available** → Install |
| 2      | Admin UI      | Plugins → **Install plugin** → drag the `.shplugin` from the latest GitHub Release |
| 3      | Admin UI      | Plugins → **Install plugin** → paste `plugin.json` |
| 4      | Terminal      | `./scripts/install-local.ps1` (Windows) or `./scripts/install-local.sh` (macOS/Linux) |

Option 4 also wires the local Composer + npm links so the host frontend resolves the plugin without restarting the dev server.

## Build the `.shplugin`

The `.shplugin` is a signed, checksummed ZIP that contains everything
a SelfHelp host needs to install the plugin: the manifest, the
runtime ESM bundle, the optional stylesheet, the SHA256 sums, and an
Ed25519 signature over the canonical payload.

Build locally (uses your local Ed25519 dev key):

```bash
node scripts/build-shplugin.mjs
# → dist/sh2-shp-survey-js-<version>.shplugin
```

The script:

1. Runs `npm --prefix frontend run build:runtime` (Vite library mode).
2. Stages `plugin.json` + `artifacts/{plugin.esm.js,plugin.css,SHA256SUMS}`.
3. Builds the canonical signed payload via the shared `sign.mjs`.
4. Signs with `SELFHELP_PLUGIN_SIGNING_KEY` (or
   `SELFHELP_PLUGIN_DEV_SIGNING_KEY` → keyId `dev`, dev-only).
5. ZIPs into `dist/<id>-<version>.shplugin`.
6. Self-validates by re-reading the SHA256SUMS.

Use the dev-signed archive for `Admin → Plugins → Install plugin →
Upload .shplugin` on a local host. Production hosts refuse `keyId="dev"`
on `official`/`reviewed` trust levels — see
[`docs/publish.md`](docs/publish.md).

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
| `SELFHELP_PLUGIN_SIGNING_KEY`     | Ed25519 base64 secret key. Used to sign the canonical payload.                                  |
| `SELFHELP_PLUGIN_SIGNING_KEY_ID`  | Publisher key id. Must match an entry in the host's `SELFHELP_PLUGIN_TRUSTED_KEYS`.             |
| `REGISTRY_PUSH_TOKEN`             | PAT with `contents:write` on `humdek-unibe-ch/sh2-plugin-registry`. Missing → dry-run mode.     |

Without `REGISTRY_PUSH_TOKEN` the workflow still builds the
`.shplugin` and attaches it to the GitHub Release; only the
registry-side push is skipped (the workflow logs a warning summary).

Full publish reference: [`docs/publish.md`](docs/publish.md).

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

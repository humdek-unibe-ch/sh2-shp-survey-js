<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# Publishing the SurveyJS plugin

This guide explains how to **publish** the plugin so it shows up in
the host admin UI under **Plugins → Available** (Option 1 of
[`install.md`](install.md)).

> **You only need to publish once per version.** After that, every
> SelfHelp instance that has the official registry as a source can
> install your plugin with a single click.

## The official registry

SelfHelp plugins are published to the **official Humdek registry**:

| Field                | Value                                                         |
| -------------------- | ------------------------------------------------------------- |
| Source repo          | <https://github.com/humdek-unibe-ch/sh2-plugin-registry>      |
| Published catalogue  | <https://humdek-unibe-ch.github.io/sh2-plugin-registry/>      |
| Seeded as            | `humdek-public` plugin source on every SelfHelp install       |

Every SelfHelp host already has this registry seeded by host
migration `Version20260522110723`. Admins do not have to add it
manually — the row is marked as system-managed and cannot be edited
or deleted (only toggled enabled/disabled).

## Repository layout

The registry repository has exactly this shape:

```text
sh2-plugin-registry/
├── README.md
├── registry.json                          ← published index
├── registry.schema.json                   ← validation schema (CI)
├── plugin-manifest.schema.json            ← vendored host schema
├── manifests/
│   └── <plugin-id>-<version>.json         ← copy of plugin.json per release
└── .github/workflows/build-registry.yml   ← GitHub Pages publish job
```

`registry.json` lists every plugin we advertise. Each entry has a
`manifestUrl` pointing at a versioned `plugin.json` copy under
`manifests/`. The host downloads both and runs the same install
pipeline as a manual paste.

## The fast path — automatic publish

Every plugin we own ships two pieces:

1. `scripts/publish-to-registry.{ps1,sh}` — one-shot scripts that
   validate, build, copy manifests into the registry checkout,
   commit, and (with `--push`) push.
2. `.github/workflows/publish-to-registry.yml` — CI workflow that
   runs the bash script automatically when a `v*` tag is pushed.

### Local one-shot (developer machine)

Clone the registry repo as a sibling of the plugin checkout:

```text
plugins/
├── sh2-shp-survey-js/        ← this plugin
└── sh2-plugin-registry/      ← https://github.com/humdek-unibe-ch/sh2-plugin-registry
```

Then run from the plugin root:

```powershell
.\scripts\publish-to-registry.ps1 -Push     # Windows / PowerShell
```

```bash
./scripts/publish-to-registry.sh --push     # Linux / macOS / WSL
```

What the script does:

1. Reads `plugin.json` for `id`, `version`, `name`, `description`,
   `homepage`, and `security.trustLevel`.
2. Validates the manifest against the vendored
   `docs/plugins/plugin-manifest.schema.json` (best-effort — passes
   silently if `ajv-cli` is not installed).
3. Builds the frontend + mobile npm packages.
4. Copies `plugin.json` to
   `<registry>/manifests/<plugin-id>-<version>.json`.
5. Inserts / updates the plugin entry in `<registry>/registry.json`,
   sorted by id, with refreshed `publishedAt`.
6. Commits in the registry repo with message
   `publish: <id>@<version> (<channel>/<trust>)`.
7. With `--push`, pushes to `origin`. The registry repo's
   `build-registry.yml` workflow then republishes the static site to
   GitHub Pages.

Available flags:

| Flag (PowerShell)        | Flag (bash)         | Description                                              |
| ------------------------ | ------------------- | -------------------------------------------------------- |
| `-RegistryPath <path>`   | `--registry <path>` | Override the registry repo location.                     |
| `-Channel <name>`        | `--channel <name>`  | `stable` (default), `beta`, `rc`, or `dev`.              |
| `-TrustLevel <name>`     | `--trust <name>`    | `official`, `reviewed`, or `untrusted`.                  |
| `-DryRun`                | `--dry-run`         | Show the diff without writing.                           |
| `-Push`                  | `--push`            | Push the registry commit.                                |
| `-PublishNpm`            | `--publish-npm`     | Also run `npm publish` on the frontend + mobile packages.|
| `-SkipBuild`             | `--skip-build`      | Skip the local rebuild step.                             |

### CI publish (recommended)

The plugin includes `.github/workflows/publish-to-registry.yml` which
runs the same bash script automatically.

Trigger:

- `push: tags: ["v*"]` — automatic on release tags.
- `workflow_dispatch` — manual run from the **Actions** tab with a
  `channel` input (`stable` / `beta` / `rc` / `dev`).

Setup once:

1. Generate a fine-scoped PAT with `contents:write` on
   `humdek-unibe-ch/sh2-plugin-registry`.
2. Add it as a repo secret named `REGISTRY_PUSH_TOKEN` on
   `humdek-unibe-ch/sh2-shp-survey-js`.

After that, releasing a new version is a single command:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow validates the manifest, builds frontend + mobile,
publishes to the registry, and the registry's own workflow
re-publishes to GitHub Pages. Hosts pick the new version up the next
time an admin opens the **Available** tab.

If `REGISTRY_PUSH_TOKEN` is unset, the workflow still builds and
validates but skips the publish step and emits a CI warning.

## Versioning rules

1. Bump `version` in three places: `plugin.json`,
   `frontend/package.json`, `mobile/package.json`. All three must
   agree — the publish script reads from `plugin.json` and the host
   verifies the published npm packages match.
2. Update `CHANGELOG.md`.
3. Run the local tests (`composer test`, `npm run typecheck`).
4. Commit, tag (`git tag vX.Y.Z`), and push the tag.
5. CI takes over from there.

Older versions of the same plugin stay in `registry.json` so hosts
that pin a specific range can still install them. The host's
`VersionResolver` picks the highest version that matches the host's
compatibility range.

## Publishing the npm packages (optional)

When the publish script is run with `--publish-npm` (PowerShell:
`-PublishNpm`) it also runs `npm publish --access public` on the
frontend and mobile packages.

That gives consumers:

- `@humdek/sh2-shp-survey-js@<version>` on the public npm registry
- `@humdek/sh2-shp-survey-js-mobile@<version>` on the public npm registry

The host frontend / mobile resolve plugin code via these npm
packages, so they must be published before the install will
finalise on production hosts.

> **Where to keep credentials?** Run `npm login` once on the
> developer machine, then the publish script picks up the existing
> session. For CI, store an npm automation token as the workflow
> secret `NPM_TOKEN` and add an `npm config set //registry.npmjs.org/:_authToken $NPM_TOKEN`
> step before the publish workflow if you decide to enable
> `--publish-npm` from CI.

## Publishing the backend Composer package (optional)

The backend bundle is a normal Composer package. Submit the GitHub
repo once at <https://packagist.org/packages/submit>. After that,
every tag pushed to `humdek-unibe-ch/sh2-shp-survey-js` is picked up
by Packagist automatically. Users install the bundle with:

```bash
composer require humdek/sh2-shp-survey-js:^0.1
```

## Trust levels

The host enforces the `security.trustLevel` field at install time:

| Trust level | Effect at install time                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `official`  | Installs without warning.                                                                                     |
| `reviewed`  | Installs with a short info notice.                                                                            |
| `untrusted` | Installer asks for explicit confirmation **per capability** (e.g. "this plugin wants `writeDataTables`").    |

Plugins published from `humdek-unibe-ch/sh2-plugin-registry` should
use `official`. To use any other trust level on your own private
registry, sign the manifest with Ed25519 keys (see
[`trust-levels.md`](../../sh-selfhelp_backend/docs/plugins/trust-levels.md)
in the host repo).

## Adding additional plugin sources (optional)

Most installs only need the seeded official registry. If your team
runs an internal staging registry or wants to host a private mirror,
add it via **Admin → Plugins → Sources → Add source**:

- **Public registry** — leave the auth fields empty. The host calls
  `<URL>/registry.json` unauthenticated.
- **Private registry** — set both **Auth header name** and **Auth
  secret env var name**. The token value itself is never stored in
  the database; the host reads it from the named environment
  variable at fetch time. Match the header name to whatever your
  reverse proxy / GitHub Pages enterprise URL / API gateway
  expects (e.g. `Authorization`, `X-Plugin-Token`).
- **Git** — point at a Git URL. The host clones into a temporary
  directory and reads `plugin.json` from the working tree.
- **Local** — point at an absolute filesystem path containing
  `registry.json`. Useful during development when the registry
  lives next to the host on disk.

Only the seeded `humdek-public` row is read-only; every other source
can be edited or removed at any time.

## What you commit and what you don't

Commit to git:

- `plugin.json`, `CHANGELOG.md`, `README.md`, `docs/**`.
- `frontend/src/**`, `frontend/package.json`, `frontend/tsconfig.json`.
- `backend/src/**`, `backend/composer.json`.
- `mobile/src/**`, `mobile/package.json`.
- `scripts/install-local.{ps1,sh}` and `scripts/publish-to-registry.{ps1,sh}`.
- `.github/workflows/*.yml`.

Do **not** commit:

- Any `node_modules/`.
- `vendor/` (Composer dependencies).
- Build outputs under `dist/` — those go in the published npm
  tarballs, not in git.
- `*.env` and any registry secrets.

## TL;DR

```bash
# 1. Bump versions in plugin.json, frontend/package.json, mobile/package.json.
# 2. Update CHANGELOG.md.
# 3. Tag and push:
git tag v0.1.0
git push origin v0.1.0
# 4. CI publishes to the official registry; hosts see the new version
#    next time they open Admin → Plugins → Available.
```

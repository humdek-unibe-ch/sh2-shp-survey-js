<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# Publishing the SurveyJS plugin

Audience: Operators and deployers.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-06-03.
Source of truth: Runtime configuration, environment variables, scripts, and deployment services.

This guide explains how to **publish** the plugin so it shows up in
the host admin UI under **Plugins → Available** (Option 1 of
[`install.md`](./install.md)).

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

## Archive modes — connected vs standalone

Every `.shplugin` we publish ships in one of two modes. The default
is `connected`. Use `--mode standalone` when you need the host to
install the plugin's backend Composer package from the archive
itself instead of Packagist.

| Mode | What the archive contains | What the host does on install | When to use |
| ---- | ------------------------- | ----------------------------- | ----------- |
| `connected` (default) | Manifest + signature + frontend ESM + checksums. **No** backend PHP source. | `composer require humdek/<id>:<ver>` against Packagist / the configured Composer repo. | Public plugins, registry installs, fastest publish loop. |
| `standalone` | Connected layout **plus** `backend/package/` (the plugin's Symfony bundle Composer package). | Promotes `backend/package/` into `installed/`, registers a Composer **path** repository pointing at it (with `options.symlink=false`), then `composer require humdek/<id>:<ver>` from the path repo. Third-party PHP deps (symfony/*, doctrine/*, …) are still pulled from Packagist. | Air-gapped / restricted-network hosts, deterministic vendored distributions, snapshot deployments. |

Trigger by passing `--mode <connected|standalone>` to
`scripts/build-shplugin.mjs` (and to
`scripts/publish-to-registry.mjs`, which forwards the flag). The CLI
flag wins over `plugin.json#archive.mode`.

For this plugin repo, `connected` mode resolves the Symfony bundle
from the repo-root `composer.json`; the PHP source itself still lives
under `backend/` and is autoloaded from there.

### Publisher contract for standalone archives

`scripts/build-shplugin.mjs --mode standalone` enforces three rules
before staging the backend slot. The host's
`PluginArchiveValidator` enforces the same rules at install time, so
publishing a non-conforming archive fails twice — once locally, once
on every host.

1. The repo-root `composer.json#name` MUST equal
   `plugin.json#backend.composer.package`.
2. The repo-root `composer.json#version` MUST equal `plugin.json#version`.
   You set this field explicitly in the root `composer.json` rather
   than letting Composer derive it from a Git tag, because the
   archive may be built outside the Git working tree.
3. The repo-root `composer.json#scripts` must be empty (or unset).
   Composer scripts can run arbitrary shell on `composer require` —
   the host validator rejects them unless the operator sets
   `SELFHELP_PLUGIN_ALLOW_COMPOSER_SCRIPTS=1` (advanced, not
   recommended).

`backend/vendor/` is **never** included by the build script — the
archive format does not vendor third-party deps. Operators on fully
air-gapped hosts must arrange for Packagist mirroring separately.

## The fast path — automatic publish

Every plugin we own ships two pieces:

1. `scripts/publish-to-registry.mjs` — single cross-platform Node
   script that builds the signed `.shplugin`, copies the manifest +
   runtime artifacts into the registry checkout, splices the signed
   entry into `registry.json`, commits, and (with `--push`) pushes.
2. `.github/workflows/publish-to-registry.yml` — CI workflow that
   runs the same Node script automatically when a `v*` tag is pushed.

### Local one-shot (developer machine)

Clone the registry repo as a sibling of the plugin checkout:

```text
plugins/
├── sh2-shp-survey-js/        ← this plugin
└── sh2-plugin-registry/      ← https://github.com/humdek-unibe-ch/sh2-plugin-registry
```

Drop your signing key + paths into `<plugin>/.env` (gitignored, see
[`.env.example`](../../.env.example)) so you don't have to export them in
every shell — every script in `scripts/` auto-loads `.env` via Node 22's
`process.loadEnvFile`. Then run from the plugin root:

```bash
node scripts/publish-to-registry.mjs --push
```

The same command works on PowerShell, Git Bash, WSL, macOS and Linux.

What the script does:

1. Reads `plugin.json` for `id`, `version`, `name`, `description`,
   `homepage`, and `security.trustLevel`.
2. Calls `node scripts/build-shplugin.mjs` to build + sign the
   `.shplugin` install artifact (the backend downloads + extracts it
   and self-hosts the runtime).
3. Computes the `.shplugin` SHA-256, then calls the registry repo's
   `scripts/build-plugin-release.mjs` + `scripts/sign-release.mjs` to
   emit a signed `releases/plugins/<id>-<version>.json` document.
4. Copies `plugin.json` to
   `<registry>/manifests/<plugin-id>-<version>.json`.
5. Copies `dist/<id>-<ver>.shplugin` to
   `<registry>/artifacts/<id>-<ver>.shplugin`.
6. Adds / updates the release **ref** in `<registry>/registry.json`
   `plugins[]` (multi-version: other versions kept, same id+version
   replaced), with refreshed `publishedAt`.
7. Commits in the registry repo with message
   `publish: <id>@<version> (<channel>)`.
8. With `--push`, pushes to `origin`. The registry repo's
   `build-registry.yml` workflow then republishes the static site to
   GitHub Pages.

Available flags:

| Flag                | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `--registry <path>` | Override the registry repo location (or set `SELFHELP_REGISTRY_PATH`).     |
| `--channel <name>`  | `stable` (default), `beta`, `nightly`, or `test`.                          |
| `--mode <name>`     | Archive mode: `connected` (default) or `standalone`. Forwarded to `build-shplugin.mjs`. See the table above. |
| `--dry-run`         | Print planned changes without writing or committing.                       |
| `--push`            | `git push` the registry commit to origin.                                  |
| `--release`         | Also run `gh release create v<version> dist/<id>-<ver>.shplugin --notes-file CHANGELOG.md`. |
| `--skip-build`      | Skip the local frontend rebuild inside `build-shplugin.mjs`.               |
| `-h`, `--help`      | Print usage.                                                               |

### CI publish (recommended)

The plugin includes `.github/workflows/publish-to-registry.yml` which
runs `node scripts/publish-to-registry.mjs` automatically.

Trigger:

- `push: tags: ["v*"]` — automatic on release tags.
- `workflow_dispatch` — manual run from the **Actions** tab with a
  `channel` input (`stable` / `beta` / `nightly`).

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
3. Run the local checks (`vendor/bin/phpstan analyse -c backend/phpstan.neon.dist --memory-limit=1G`, `npm run typecheck`).
4. Commit, tag (`git tag vX.Y.Z`), and push the tag.
5. CI takes over from there.

Older versions of the same plugin stay in `registry.json` so hosts
that pin a specific range can still install them. The host's
`VersionResolver` picks the highest version that matches the host's
compatibility range.

## Publishing the npm packages (optional)

The `.shplugin` carries the runtime ESM bundle directly (see
[`shplugin-archive.md`](../../../../sh-selfhelp_backend/docs/plugins/shplugin-archive.md)),
so a registry-only release does not need an npm publish. If you want
the frontend / mobile packages on the public npm registry too, run
`npm publish --access public` from `frontend/` and `mobile/` after the
registry push:

```bash
(cd frontend && npm publish --access public)
(cd mobile   && npm publish --access public)
```

That gives consumers:

- `@humdek/sh2-shp-survey-js@<version>` on the public npm registry
- `@humdek/sh2-shp-survey-js-mobile@<version>` on the public npm registry

> **Where to keep credentials?** Run `npm login` once on the
> developer machine, then `npm publish` picks up the existing session.
> For CI, store an npm automation token as the workflow secret
> `NPM_TOKEN` and add a dedicated `npm publish` step.

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
[`trust-levels.md`](../../../../sh-selfhelp_backend/docs/plugins/trust-levels.md)
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
- `backend/src/**`, root `composer.json`.
- `mobile/src/**`, `mobile/package.json`.
- `scripts/build-shplugin.mjs`, `scripts/install-local.mjs`, `scripts/publish-to-registry.mjs`.
- `.env.example` (template; never commit `.env`).
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
# next time they open Admin → Plugins → Available.
```

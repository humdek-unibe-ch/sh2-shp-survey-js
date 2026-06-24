# AGENTS.md

Before returning anything print in chat `❤️AGENTS.md` so that we know the rules are used.

## Project Overview

This is the SelfHelp plugin `sh2-shp-survey-js`. It provides SurveyJS v2 integration for the SelfHelp CMS: a Mantine-themed Survey Creator for admins, a public-runtime SurveyJS style, optional GPX / Video / rich-text custom question types, a response dashboard, and a readonly mobile renderer.

## Critical execution rule

This project lives inside the multi-repository SelfHelp ecosystem.

The AI agent must always obey the `AGENTS.md` of the repository whose files are being modified, regardless of where the agent was started.

When working inside this plugin repository, choose the governing repository rules by the part of the plugin being edited:

- `backend/` changes: follow this plugin `AGENTS.md` and the host backend repository `AGENTS.md`.
- `frontend/` changes: follow this plugin `AGENTS.md` and the host frontend repository `AGENTS.md`.
- `mobile/` changes: follow this plugin `AGENTS.md` and the host mobile repository `AGENTS.md`.
- changes that import from or depend on `@selfhelp/shared`: also read and follow the shared package `AGENTS.md`.
- changes that touch more than one area: read and apply the rules for each affected repository separately.

Do not use backend conventions for frontend files, frontend conventions for mobile files, or mobile conventions for backend files.

### Rule precedence

When editing `backend/` files:

1. Runtime code and existing implementation.
2. Host backend repository `AGENTS.md`.
3. Canonical multi-repository rules.
4. This plugin `AGENTS.md`.
5. Documentation.

Plugin rules supplement backend rules and do not replace them unless explicitly stated.

When editing `frontend/` files:

1. Runtime code and existing implementation.
2. Host frontend repository `AGENTS.md`.
3. Canonical multi-repository rules.
4. This plugin `AGENTS.md`.
5. Documentation.

Plugin rules supplement frontend rules and do not replace them unless explicitly stated.

When editing `mobile/` files:

1. Runtime code and existing implementation.
2. Host mobile repository `AGENTS.md`.
3. Canonical multi-repository rules.
4. This plugin `AGENTS.md`.
5. Documentation.

Plugin rules supplement mobile rules and do not replace them unless explicitly stated.

When editing code that imports from or depends on `@selfhelp/shared`:

1. Runtime code and existing implementation.
2. The `AGENTS.md` of the host repository owning the edited files.
3. Shared package `AGENTS.md`.
4. Canonical multi-repository rules.
5. This plugin `AGENTS.md`.
6. Documentation.

If two rule sources conflict, the repository that owns the edited files wins unless this plugin `AGENTS.md` explicitly declares an additional plugin-specific constraint.

### Repository discovery

Repository locations are environment-specific.

Do not assume absolute paths such as:

- `D:\...`
- `/home/...`
- `/Users/...`

Discover repositories from:

- the current workspace;
- sibling repositories in the current workspace;
- repository names;
- explicitly provided user paths;
- local developer configuration files such as `AGENTS.local.md`.

If `AGENTS.local.md` exists, use it as the first place to resolve the local paths of:

- `sh-selfhelp_backend`
- `sh-selfhelp_frontend`
- `sh-selfhelp_shared`
- `sh-selfhelp_mobile`
- sibling plugin repositories when relevant

### Required repository rules

Before modifying any plugin area, identify which host repository owns the conventions for that area and read its `AGENTS.md`.

- For `backend/`, read the backend repo `AGENTS.md`.
- For `frontend/`, read the frontend repo `AGENTS.md`.
- For `mobile/`, read the mobile repo `AGENTS.md`.
- For changes involving `@selfhelp/shared`, read the shared repo `AGENTS.md`.
- Follow that repository's rules for architecture, coding style, migrations, testing, validation, commits, and documentation.
- Do not apply conventions from one repository to another unless explicitly documented.

Typical repositories participating in plugin development are:

- `sh-selfhelp_backend`
- `sh-selfhelp_frontend`
- `sh-selfhelp_shared`
- `sh-selfhelp_mobile`
- affected plugin repositories

### Canonical multi-repository rules

The canonical Multi-Repository AGENTS.md Rule lives in the backend repository:

```text
docs/plugins/multi-repo-agents-md.md
```

If the backend repository is available, read that document before making multi-repository changes.

If it is unavailable:

- continue using the rules in the current repository;
- clearly state that the canonical document could not be located.

## Documentation Rules

These rules apply to every documentation change in active SelfHelp2 repositories. Copy this section unchanged across repository `AGENTS.md` files so agents get the same documentation contract without following a central link.

- Organize documentation by audience and purpose, not by implementation history: `docs/developer/` for technical architecture/workflow docs, `docs/user/` for non-technical feature/admin/operator guides, `docs/reference/` for exact contracts/tables/schemas/API details, `docs/cookbook/` for task recipes, `docs/operations/` for install/deploy/publish/runbooks, and `docs/archive/` for historical notes.
- Every docs root should have `docs/README.md` as the navigation entrypoint. Tiny repos may keep documentation in the root `README.md` until they need more than one doc. Preserve canonical exceptions such as backend `docs/plugins/` when moving files would break important links; add indexes/status notes first, migrate only after references are updated.
- New or substantially rewritten docs must begin with this metadata block: `Audience`, `Status`, `Applies to`, `Last verified`, `Source of truth`.
- Documentation filenames should use lowercase kebab-case, one `#` title, ASCII punctuation, no emoji headings, repo-relative links, concrete dates instead of "latest/current" when time-sensitive, and no local absolute paths.
- Write developer docs for engineers/technical operators with architecture, contracts, commands, and tradeoffs. Write user docs for non-technical users/operators as task-based steps with expected results and minimal implementation jargon.
- Update documentation in the same change when behavior changes affect user-visible behavior, API contracts, schemas/types, permissions/auth, database/migrations, config/env vars, build/deploy/publish flow, plugin capabilities, or testing commands.
- Do not expose secrets, tokens, private keys, database URLs, Mercure/JWT secrets, or real credentials in docs, examples, logs, or screenshots. Use redacted examples and documented env var names only.
- When docs conflict with runtime behavior, treat runtime behavior as source of truth, flag the stale doc, and update or archive it instead of copying the conflict.

### Required-before-coding checklist

- [ ] Identify all repositories affected by the task.
- [ ] Locate each repository in the current environment.
- [ ] Read `AGENTS.md` in every affected repository.
- [ ] Read the canonical multi-repository rule if available.
- [ ] Summarize relevant rules per repository.
- [ ] Confirm planned file changes per repository.
- [ ] Apply changes repository-by-repository.
- [ ] Run validation commands from the matching repository.
- [ ] Do not mix backend, frontend, shared, mobile, and plugin conventions.

### Quick routing guide

Use this guide before editing:

- editing `backend/**`: plugin rules + backend repo rules
- editing `frontend/**`: plugin rules + frontend repo rules
- editing `mobile/**`: plugin rules + mobile repo rules
- editing code that imports `@selfhelp/shared`: also apply shared repo rules
- editing docs or root files only: use this plugin `AGENTS.md`, and add host repo rules only if the change is tied to one of the areas above

## Doctrine Migration Rules

### Backend schema inheritance

When creating or modifying plugin backend database objects:

- Follow all backend repository database rules.
- Follow all backend naming conventions.
- Follow all backend migration rules.
- Follow all backend foreign-key naming rules.
- Follow all backend relation-table naming rules.

Plugin database schema must be indistinguishable from native backend schema unless an explicit compatibility exception is documented.

Examples:

- plural `lowercase_snake_case` table names
- `id_<table_name>` foreign keys
- `rel_<table_a>_<table_b>` relation tables
- Symfony-generated Doctrine migrations

### Doctrine migrations are mandatory

- Database changes must use Symfony/Doctrine migrations.
- Doctrine migrations are the only supported schema migration mechanism.
- Do not modify existing applied migrations unless explicitly instructed.
- Create a new migration for every schema change.

### Migration generation (MANDATORY)

- Never manually create Doctrine migration filenames.
- Never manually create Doctrine migration class names.
- Never invent migration names such as:
  - `Version20260521150000`
  - `Version20260521150100`
  - or any other hand-written timestamp-based migration class.
- Always generate migrations using the repository's official Symfony/Doctrine migration generation command.
- The generated filename and generated class name are the only allowed migration names.
- After generation, modify the migration contents if required.
- Do not rename generated migrations.
- Do not manually create migration files inside the migrations directory.
- Do not guess future migration version numbers.
- Do not create migration classes by copying previous migrations.

### Migration execution

- Existing editor rules prohibit automatically executing migrations.
- Generate migration files only.
- Let the development team execute migrations manually.
- Do not run migration commands automatically unless explicitly instructed.

### Migration review requirements

Before creating a migration:

- Inspect existing entities.
- Inspect existing Doctrine mappings.
- Inspect existing migrations.
- Verify naming conventions.
- Verify foreign key conventions.
- Verify index naming conventions.
- Verify compatibility with existing repository architecture.

### Audit requirements

During audits and code reviews:

- Treat manually-created migration filenames as a repository rule violation.
- Treat manually-created migration class names as a repository rule violation.
- Treat invented timestamp-based migration names as a repository rule violation.
- Verify migrations were generated through the repository's official Symfony/Doctrine migration workflow.

## Plugin Registry / Publishing Rules

This plugin (and every SelfHelp plugin we own) is published to the
official Humdek plugin registry at
<https://github.com/humdek-unibe-ch/sh2-plugin-registry> which is
served at <https://humdek-unibe-ch.github.io/sh2-plugin-registry/>.

### Required scripts

Every plugin MUST ship the following files under `scripts/`:

- `scripts/build-shplugin.mjs` — single cross-platform Node script
  that builds + signs the `.shplugin`.
- `scripts/install-local.mjs` — single cross-platform Node script
  that installs the plugin on a local host (`.shplugin` upload by
  default, `--symlink` fast-path optional).
- `scripts/publish-to-registry.mjs` — single cross-platform Node
  script that builds, signs, copies into the sibling
  `sh2-plugin-registry`, creates the signed per-version plugin release,
  adds its multi-version ref to `registry.json`, commits, and optionally
  pushes / creates a GitHub Release.
- `.github/workflows/publish-to-registry.yml` — CI workflow that
  runs `node scripts/publish-to-registry.mjs` on `v*` tag pushes
  and on manual dispatch.

Do **not** ship `.ps1` / `.sh` wrappers. Every supported OS
(PowerShell, Git Bash, WSL, macOS, Linux) runs the same `.mjs`
files. The host's `docs/plugins/` documentation enforces this
convention.

Every plugin MUST also ship a `.env.example` documenting the
`SELFHELP_SIGNING_KEY` / `SELFHELP_SIGNING_KEY_ID` /
`SELFHELP_ADMIN_TOKEN` / `SELFHELP_API_BASE` / `SELFHELP_BACKEND_PATH`
/ `SELFHELP_REGISTRY_PATH` env variables the scripts consume. The
scripts auto-load `<plugin-root>/.env` via Node 22's
`process.loadEnvFile`. NEVER commit `.env`.

### What the publish script does

1. Reads `plugin.json` and builds the signed connected `.shplugin`
   (skippable with `--skip-build`).
2. Resolves the registry base URL from the CLI/env or `registry.json`.
3. Copies `plugin.json` to
   `<registry>/manifests/<plugin-id>-<version>.json` and the archive to
   `<registry>/artifacts/<plugin-id>-<version>.shplugin`.
4. Calls the registry's `build-plugin-release.mjs` and
   `sign-release.mjs` helpers to create
   `releases/plugins/<plugin-id>-<version>.json`.
5. Adds `{id, version, channel, releaseUrl}` to `registry.json`,
   replacing only the same id+version while retaining all other
   published versions; then refreshes `publishedAt` and sorts by id/version.
6. Commits the registry changes with
   `publish: <id>@<version> (<channel>)`.
7. Optional `--push` pushes the registry commit; optional `--release`
   creates the plugin GitHub Release. The script does not publish npm packages.

### Sibling-folder convention

By default the script expects the registry checkout to be a sibling
of the plugin checkout:

```text
plugins/
├── sh2-shp-survey-js/       ← this plugin
└── sh2-plugin-registry/     ← official registry repo
```

A different location may be passed via `--registry <abs-path>` or
`SELFHELP_REGISTRY_PATH` in `.env`.

### CI publishing

The plugin's `publish-to-registry.yml` workflow runs on:

- `push: tags: ["v*"]` — automatic on release tags.
- `workflow_dispatch` — manual trigger from the **Actions** tab,
  with a `channel` input.

The workflow uses a `REGISTRY_PUSH_TOKEN` repo secret (a PAT with
`contents:write` on `humdek-unibe-ch/sh2-plugin-registry`). If the
secret is unset the job still builds + validates but skips the
push step and prints a warning.

### Do not bypass the script

When adding a new plugin to the registry, run
`node scripts/publish-to-registry.mjs`. Do NOT hand-edit
`registry.json` or hand-copy manifests, because the script enforces:

- Schema validation.
- Signed per-version release documents and archive checksums.
- Multi-version ref replacement (same id+version only) and consistent sorting.
- Atomic registry commits with a uniform message format.
- Updated `publishedAt`.
- Single canonical signed payload reused for both the `.shplugin`
  and host verification.

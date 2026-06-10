<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# GitHub Actions secrets setup

Audience: Operators and deployers.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-06-03.
Source of truth: Runtime configuration, environment variables, scripts, and deployment services.

Walk-through for configuring the three secrets that
`.github/workflows/publish-to-registry.yml` consumes on every `v*`
tag push. The same recipe works for every SelfHelp plugin repo.

> **Local-only?** Skip this whole page. Drop
> `SELFHELP_PLUGIN_DEV_SIGNING_KEY=<base64>` into a gitignored
> `<plugin>/.env` (copy [`.env.example`](../../.env.example) and edit),
> then run `node scripts/build-shplugin.mjs`. The dev key produces a
> `.shplugin` with `keyId="dev"`. For an `official` / `reviewed`
> plugin the host accepts that **only when `APP_ENV=dev`** and the
> matching public key is in `SELFHELP_PLUGIN_TRUSTED_KEYS`
> (`dev=<base64-public-key>`). On `APP_ENV=prod` / `APP_ENV=test`
> the host refuses `keyId="dev"` regardless of trusted-keys — use
> a real CI keypair instead.

## TL;DR — generate an Ed25519 keypair

The plugin author's signing keypair must match the
`sodium_crypto_sign_keypair()` format the host uses for
verification (64-byte secret key, 32-byte public key). The
`sign.mjs keygen` command in the registry repo emits the exact
shape required:

```bash
# Clone the registry repo once (sibling to your plugin checkout).
git clone https://github.com/humdek-unibe-ch/sh2-plugin-registry ../sh2-plugin-registry

# Generate a keypair.
node ../sh2-plugin-registry/scripts/sign.mjs keygen
# → { "publicKey": "...", "privateKey": "..." }
```

Save both values somewhere safe (a password manager works).

For local development drop the `privateKey` into the gitignored
`<plugin>/.env`:

```dotenv
# <plugin>/.env (copy from .env.example, never commit)
SELFHELP_PLUGIN_DEV_SIGNING_KEY=<privateKey>
```

`scripts/build-shplugin.mjs`, `install-local.mjs` and
`publish-to-registry.mjs` all auto-load this file via Node 22's
`process.loadEnvFile`, so you do not have to export the secret in
every shell. Real `process.env` values still win, so CI secrets
override `.env` automatically.

For CI, paste the `privateKey` into a GitHub secret (step 2 below) and
the `publicKey` into the host's `SELFHELP_PLUGIN_TRUSTED_KEYS` env
(step 5).

> **Do not** generate the key with `crypto.randomBytes(64)` — that
> produces 64 random bytes, not the structured 64-byte Ed25519
> secret key libsodium expects. Always use `sign.mjs keygen`.

## 1. Open the plugin repository

Browse to your plugin repo on GitHub, e.g.
<https://github.com/humdek-unibe-ch/sh2-shp-survey-js>.

Click **Settings → Secrets and variables → Actions**.

## 2. Add `SELFHELP_SIGNING_KEY`

| Field  | Value                                                            |
|--------|------------------------------------------------------------------|
| Name   | `SELFHELP_SIGNING_KEY`                                    |
| Secret | Base64 of the raw 64-byte Ed25519 secret key (output of step 0). |

This is the private half of the signing keypair. Treat it like a
production password: rotate when an author leaves, never echo to a
chat or paste into another repo. The host never sees this value.

## 3. Add `SELFHELP_SIGNING_KEY_ID`

| Field  | Value                                                                                                |
|--------|------------------------------------------------------------------------------------------------------|
| Name   | `SELFHELP_SIGNING_KEY_ID`                                                                     |
| Secret | A short identifier the host recognises, e.g. `humdek-2026-01` (vendor + year + rotation generation). |

The `keyId` is **not** a secret in the cryptographic sense — it is
embedded in every signed payload so the host knows which public key
to use for verification. You will tell the host about this id in
step 5.

Recommended naming convention: `<vendor>-<year>-<rotation>` so a
yearly rotation produces `humdek-2026-01`, `humdek-2027-01`, etc.
Old keyIds remain valid until removed from the host's trusted-keys
env.

## 4. Add `REGISTRY_PUSH_TOKEN` (optional)

The plugin's publish workflow needs write access to the public
registry repo (`humdek-unibe-ch/sh2-plugin-registry`) to splice the
new entry into `registry.json`. GitHub Actions tokens are scoped to
the **current** repo by default, so we need a Personal Access Token
that scopes to the registry repo too.

1. Click your GitHub avatar → **Settings** → **Developer settings**
   → **Personal access tokens** → **Fine-grained tokens** →
   **Generate new token**.
2. Token name: `selfhelp-plugin-registry-publish`. Expiration: as
   short as the rotation policy allows (1 year is reasonable).
3. **Repository access**: *Only selected repositories* →
   `humdek-unibe-ch/sh2-plugin-registry`.
4. **Repository permissions**: **Contents: Read and write**.
5. Generate and copy the token. (You only see it once.)
6. Back in the plugin repo's **Actions secrets**, click *New
   repository secret*:

| Field  | Value                                            |
|--------|--------------------------------------------------|
| Name   | `REGISTRY_PUSH_TOKEN`                            |
| Secret | The fine-grained PAT generated above.            |

> Without `REGISTRY_PUSH_TOKEN` the workflow **still builds the
> `.shplugin` and attaches it to the GitHub Release**. Only the
> registry-side push is skipped (and the workflow logs a warning
> summary).

## 5. Tell the host about the public key

This is the step many people miss. The host validates every signed
payload against `SELFHELP_PLUGIN_TRUSTED_KEYS` — if your `keyId` is
not in that env var the install fails with `signature key not
trusted (keyId=<id>)`.

On every SelfHelp host that should accept your plugin, edit
`.env.local` (or your secret manager):

```bash
SELFHELP_PLUGIN_TRUSTED_KEYS=humdek-2026-01=<base64-public-key>;another-keyId=<base64-public-key2>
```

The format is `keyId=base64Public; keyId=base64Public; …` (one
entry per trusted publisher). Restart the host PHP-FPM / web
worker so Symfony picks up the new env var.

## 6. Verify the setup

```bash
# In the plugin repo, locally:
# - drop the production keypair into <plugin>/.env (gitignored), OR
# - export them inline like below.

SELFHELP_SIGNING_KEY=<your-secret> \
SELFHELP_SIGNING_KEY_ID=humdek-2026-01 \
node scripts/build-shplugin.mjs

# → dist/sh2-shp-survey-js-<version>.shplugin signed with the
# production key. Upload it to a staging host and confirm it
# installs without "signature key not trusted".
```

Then push a tag and watch the **Actions** tab:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The workflow log should show:

1. `Build .shplugin (signed)` step succeeds.
2. `Publish to registry` step pushes a commit to the registry repo
   under `manifests/<id>-<version>.json` and `artifacts/<id>-<version>/`.
3. `Create GitHub Release` step attaches the `.shplugin` as a release
   asset and uses the per-version `CHANGELOG.md` section as the body.
4. The registry repo's own `build-registry.yml` workflow re-validates
   and republishes the static catalogue at
   <https://humdek-unibe-ch.github.io/sh2-plugin-registry/>.

## Rotating the signing key

1. Generate a new keypair (step 0).
2. Add the new keyId + public key to the host's
   `SELFHELP_PLUGIN_TRUSTED_KEYS` alongside the old one.
3. Update the plugin's `SELFHELP_SIGNING_KEY` +
   `SELFHELP_SIGNING_KEY_ID` secrets.
4. Wait one release cycle for all hosts to pick up the new pub key.
5. Remove the old keyId from `SELFHELP_PLUGIN_TRUSTED_KEYS`.

The host doctor warns when a plugin's recorded `signing.keyId` no
longer appears in the trusted-keys env.

## Troubleshooting

| Symptom                                                       | Fix                                                                                                 |
|---------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `signature key not trusted (keyId=<id>)`                      | Add the public key to the host's `SELFHELP_PLUGIN_TRUSTED_KEYS` and restart the host worker.        |
| `signature verification failed`                               | The secret in `SELFHELP_SIGNING_KEY` does not match the public key. Regenerate the pair.     |
| `Signing key must be 64 bytes (got N)`                        | The key was generated with `randomBytes(64)` instead of `sign.mjs keygen`. Re-generate using keygen.|
| Workflow exits with `REGISTRY_PUSH_TOKEN is not set` warning  | Expected when running without the token. Add the token to enable auto-publish to the registry repo. |
| `vite: not found` during local build                          | Run `node scripts/build-shplugin.mjs` — it auto-installs `frontend/node_modules` if `vite` is missing.|
| `SHA256SUMS entry "<file>" must be archive-root-relative`     | You're running an old `build-shplugin.mjs`. Pull the latest plugin scripts; the canonical layout writes `<hash>  artifacts/<file>`. |
| Workflow run says *No jobs were run*                          | The publish workflow only triggers on `v*` tags. Use `workflow_dispatch` from the Actions UI for ad-hoc runs. |

## See also

- [`docs/publish.md`](./publish.md) — full publish guide.
- [Host backend `signing.md`](https://github.com/humdek-unibe-ch/sh-selfhelp_backend/blob/main/docs/plugins/signing.md) — cryptographic contract.
- [Host backend `trusted-keys.md`](https://github.com/humdek-unibe-ch/sh-selfhelp_backend/blob/main/docs/plugins/trusted-keys.md) — `SELFHELP_PLUGIN_TRUSTED_KEYS` env reference.
- [Host backend `publishing-workflow.md`](https://github.com/humdek-unibe-ch/sh-selfhelp_backend/blob/main/docs/plugins/publishing-workflow.md) — author lifecycle reference.

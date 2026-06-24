<!--
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
-->

# SurveyJS Plugin — Mobile Guide

Audience: Non-technical users, admins, and operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (`sh2-shp-survey-js`), mobile renderer `@selfhelp/sh2-shp-survey-js-mobile` >= 0.3.0.
Last verified: 2026-06-24.
Source of truth: Observable product behaviour of the current build (`mobile/src/`, the WebView runtime, and the host mobile shell).

This guide explains what the SurveyJS plugin does on the SelfHelp
mobile app and the CMS **mobile preview**, and how to configure it.

## What ships today

The mobile renderer hosts the **same official SurveyJS runtime the
web frontend uses** (`survey-core` + `survey-react-ui`) inside a
self-contained WebView. There is **no separate native survey UI** —
mobile renders the exact same survey JSON, so behaviour matches web.

| Capability                              | Web (Mantine) | Mobile (WebView) |
|-----------------------------------------|---------------|------------------|
| View a published survey                 | ✅            | ✅               |
| Fill in answers (all question types)    | ✅            | ✅               |
| Client-side validation                  | ✅            | ✅               |
| Conditional logic / multi-page          | ✅            | ✅               |
| **Submit answers** (real response)      | ✅            | ✅               |
| Autosave / resume a draft               | ✅            | ✅               |
| Completion screen + redirect            | ✅            | ✅               |
| Once-per-user / scheduled windows       | ✅            | ✅               |
| Submit from CMS **mobile preview**      | ✅            | ✅               |
| Survey Creator (admin tool)             | ✅            | ❌ (web-only)    |
| Side-by-side version compare            | ✅            | ❌ (web-only)    |
| GDPR erasure UI                         | ✅            | ❌ (web-only)    |

The submit path is identical to web: a mobile submission stores a
**real** survey response (the backend has no "preview" mode), so the
CMS mobile preview persists answers exactly like the live app.

## How a survey reaches a mobile screen

```text
Admin (web)  →  create + publish a survey  →  surveys / survey_versions
                                                │
Frontend page hosts a `surveyjs` section  ──────┤
                                                │
Mobile app pulls the same page              ←───┘
   via the host page API, spots the `surveyjs`
   style, and renders the plugin's mobile shell.
```

The mobile renderer:

1. Reads the same section field (`survey-js` = the published survey
   key) the web renderer reads.
2. Loads the self-contained WebView runtime (the official SurveyJS
   library, bundled inside the package — **no CDN, no network for the
   runtime itself**).
3. The WebView asks the native app to load the survey definition,
   save progress, and submit. **The native app performs every
   authenticated request** (it owns the access token and token
   refresh); the WebView never sees your token.
4. Shows SurveyJS validation, completion, and the configured redirect
   exactly as on the web.

## What the operator configures

Mobile reads the **same CMS style fields** as web — there is nothing
mobile-specific to set. The runtime honours:

| Section field / runtime option | Mobile behaviour                                   |
|--------------------------------|----------------------------------------------------|
| `survey-js` (survey key)       | Selects which published survey to render.           |
| Redirect at end                | Navigates to the CMS keyword after completion.      |
| Autosave interval              | Saves a draft so a participant can resume.           |
| Once per user / once per schedule | Server-enforced; mobile shows the locked state.  |
| Start / end time (schedule)    | Server-enforced; mobile shows "not active" labels.  |
| Completion / not-active labels | Shown by the WebView runtime.                       |

## Supported / unsupported question types

Because mobile runs the official SurveyJS library, **every standard
SurveyJS question type works** (text, comment, radio/checkbox/dropdown,
boolean, rating, ranking, matrix family, image picker, expression,
HTML, panels, dynamic panels, conditional logic, etc.).

The plugin's custom question types and a few platform features have
documented limitations inside a WebView:

| Question type / feature       | Mobile (WebView) status                                  |
|-------------------------------|----------------------------------------------------------|
| All standard SurveyJS types   | ✅ Full parity with web.                                  |
| Rich text (custom)            | ✅ Renders; editing parity follows the web adapter.       |
| File upload                   | ⚠️ Deferred — file/camera/microphone permission bridging is not wired yet; avoid required file questions on mobile for now. |
| Microphone / audio capture    | ⚠️ Deferred — same permission limitation as file upload.  |
| GPX / map tiles               | ⚠️ May be limited by the WebView content-security policy (tiles load over the network). |
| PDF export of a response      | ❌ Web-only (admin/operator feature).                     |

Unsupported items degrade **inside the same survey** with a clear
message; they never bounce the participant out to a browser. "Open on
web" only appears when the mobile renderer package is **missing or
incompatible** with the installed plugin — never for an individual
question type.

## Troubleshooting

### "The survey shows 'Open on web' instead of rendering"

The installed plugin version needs a compatible mobile renderer in the
app build. Rebuild the mobile app / preview image after the plugin is
updated, or check that `compatibility.mobile` in the plugin matches the
app's mobile renderer version (see the developer
[mobile architecture](../developer/mobile-architecture.md) doc).

### "The survey renders blank"

- Confirm the survey has a current published version.
- Confirm the device can reach the backend — the **native app** loads
  the definition and submits; if the app is signed out you will see a
  "session expired" prompt with a retry.

### "My session expired mid-survey"

Long surveys are safe: token refresh lives in the native app, not the
WebView. If your session truly expires, the shell shows a session
notice and lets you retry after re-authenticating; your in-progress
answers are kept by autosave when enabled.

## Related

- [User guide](./user-guide.md)
- [Mobile architecture (developer)](../developer/mobile-architecture.md)
- [Plugin architecture](../developer/architecture.md)
- [Publishing guide](../operations/publish.md)

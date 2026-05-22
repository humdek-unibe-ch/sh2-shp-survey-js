# SurveyJS Plugin — Mobile Guide

This guide covers what end-users and operators can expect from the
SurveyJS plugin on the SelfHelp mobile app, plus the rough roadmap
for the missing pieces.

## What ships today (v1)

| Capability                          | Web (Mantine) | Mobile (Expo) |
|-------------------------------------|---------------|---------------|
| View a published survey             | ✅            | ✅ (read-only)|
| Submit answers                      | ✅            | ❌ (planned)  |
| See your own previous answers       | ✅            | ✅            |
| Live "new answer" notifications     | ✅ (Mercure)  | ✅ (Mercure)  |
| Survey Creator (admin tool)         | ✅            | ❌ (web-only) |
| Side-by-side version compare        | ✅            | ❌ (web-only) |
| GDPR erasure UI                     | ✅            | ❌ (web-only) |
| PDF export                          | ✅            | ❌ (web-only) |

The mobile package (`@humdek/sh2-shp-survey-js-mobile`) is
intentionally small — it focuses on the read path. Authoring,
publishing, and analytics stay on the web admin shell.

## How a survey ends up on a mobile screen

```text
Admin (web) →   create + publish a survey   →  surveys / survey_versions
                                                 │
Frontend page hosts a `surveyjs` section  ───────┤
                                                 │
Mobile app pulls the same page               ←───┘
   via the host's page API (Mercure-aware),
   spots the `surveyjs` style, and asks the
   plugin's mobile entry point to render it.
```

The mobile renderer:

1. Reads the section fields (`surveyKeySlug`, `themeCode`,
   `cssVariables`, etc.) exactly the way the web renderer does.
2. Fetches the current `survey_versions` JSON.
3. Walks the definition top-down, projecting each question into a
   plain React Native primitive. There is **no** SurveyJS JS bundle
   loaded on mobile — the package ships a hand-rolled renderer so
   the APK size stays tiny.
4. Subscribes to `surveys/{surveyId}/responses` via Mercure (using
   `react-native-sse` under the hood) so admins demoing the app see
   responses light up in real time.

## Permissions

The mobile renderer honors the same permissions as the web one:

- `surveyjs.surveys.view-responses` gates the "responses summary"
  block; without it the mobile user only sees questions, not their
  neighbour's answers.
- `surveyjs.surveys.export-pdf` is web-only for now; the mobile UI
  doesn't expose it.

## Mantine vs HeroUI

The web frontend uses **Mantine v7** to keep the Survey Creator
visually integrated with the rest of the admin shell. The mobile
side intentionally does **not** depend on a specific UI library —
the package only uses React Native primitives (`<Text/>`, `<View/>`,
`<Pressable/>`, `<ScrollView/>`).

When the host mobile shell adopts **HeroUI** (planned), the plugin
will follow, and the renderer will be ported to HeroUI components.
Until then, mobile styling is purposely sparse — the upgrade has to
remain mechanical.

> **TODO** (`todo-mobile-heroui`): port the readonly renderer to
> HeroUI primitives once the host mobile shell announces the
> migration. Track progress against this guide's section.

## Configuration the operator should know about

| Section field        | Mobile behaviour                                     |
|----------------------|------------------------------------------------------|
| `mode`               | Always treated as `readonly` on mobile.              |
| `themeCode`          | Ignored; the mobile renderer uses platform defaults. |
| `richTextEditor`     | Ignored.                                              |
| `cssVariables`       | Honoured for color overrides only (background, fg).  |
| `analyticsTopicKey`  | Honoured; Mercure subscribes to the same topic.       |
| `redirectOnSubmit`   | N/A (no submit on mobile yet).                       |

## Troubleshooting

### "The survey renders blank on mobile"

- Make sure the survey has a current version. Mobile reads the same
  `surveys.id_current_survey_versions` pointer as the web client.
- Verify the device can reach Mercure. The renderer falls back to a
  cached snapshot on first load, but Mercure-driven updates require
  the SSE connection.

### "Notifications show up on web but not on mobile"

- React Native's polyfill for SSE differs per platform. The mobile
  package picks `react-native-sse` on iOS / Android and falls back
  to the browser `EventSource` on Expo Web. Run
  `npx expo start --clear` after upgrading the plugin if the
  transport seems stuck.

### "I want to submit answers from mobile right now"

- Open the mobile section in the device's external browser. The
  same URL works as the web client (the host's frontend renders a
  full Survey Creator runtime).

## Related

- [User guide](./user-guide.md)
- [Plugin architecture](./architecture.md)
- [Host realtime + no-polling policy](../../../sh-selfhelp_backend/docs/plugins/realtime-and-no-polling.md)
- [HeroUI mobile migration plan](https://github.com/humdek-unibe-ch/sh-selfhelp_mobile/issues) (when filed)

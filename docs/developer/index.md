# SurveyJS Plugin Developer Documentation

Audience: Plugin developers and technical operators.
Status: active.
Applies to: `sh2-shp-survey-js`.
Last verified: 2026-06-03.
Source of truth: `backend/src/`, `frontend/src/`, `mobile/src/`, and `plugin.json`.

Engineering documentation for the SurveyJS plugin. See [../README.md](../README.md) for the full docs map.

- [architecture.md](architecture.md) - Internals, services, schema, data flow, and security.
- [mobile-architecture.md](mobile-architecture.md) - Mobile WebView renderer: self-contained SurveyJS runtime, typed host-services bridge, native-owned auth, security model, and version axes.
- [qa-scenarios.md](qa-scenarios.md) - Manual QA scenarios for validating behavior.

For the exact manifest contract (capabilities, permissions, routes, owned tables), see [../reference/manifest.md](../reference/manifest.md).

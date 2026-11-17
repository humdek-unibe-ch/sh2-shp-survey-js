# SurveyJS Plugin Developer Documentation

Audience: Plugin developers and technical operators.
Status: active.
Applies to: `sh2-shp-survey-js`.
Last verified: 2026-06-03.
Source of truth: `backend/src/`, `frontend/src/`, `mobile/src/`, and `plugin.json`.

Engineering documentation for the SurveyJS plugin. See [../README.md](../README.md) for the full docs map.

- [concept.md](concept.md) - How the plugin works and why: who owns what, the life of a survey, what is stored where, the section fields, access, variables and the look. Draft for review; describes the design the SurveyJS 3 upgrade builds.
- [upgrade-plan.md](upgrade-plan.md) - Plan for the SurveyJS 3 upgrade: decisions, what is wrong today, core additions and the waves of work. Temporary; archived once the upgrade is done.
- [architecture.md](architecture.md) - Internals, services, schema, data flow, and security.
- [mobile-architecture.md](mobile-architecture.md) - Mobile WebView renderer: self-contained SurveyJS runtime, typed host-services bridge, native-owned auth, security model, and version axes.
- [qa-scenarios.md](qa-scenarios.md) - Manual QA scenarios for validating behavior.

For the exact manifest contract (capabilities, permissions, routes, owned tables), see [../reference/manifest.md](../reference/manifest.md).

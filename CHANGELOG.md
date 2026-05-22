# Changelog

All notable changes to `sh2-shp-survey-js` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to the [SelfHelp plugin SemVer rules](../../sh-selfhelp_backend/docs/plugins/developer-guide.md#7-versioning-and-compatibility).

## [1.0.0] — 2026-05-21

### Added

- Initial release of the SurveyJS v2 plugin.
- Backend Symfony bundle with `Survey`, `SurveyVersion`, `SurveyRun`, `SurveyAnswerLink` entities.
- Public + admin API routes under `/cms-api/v1/admin/plugins/surveyjs/*` and `/cms-api/v1/plugins/surveyjs/*`.
- Frontend npm package contributing the `surveyjs` runtime style + `gpxMap` standalone style.
- Mantine theme bridge for both the SurveyJS Creator and the runtime renderer.
- Tiptap-based rich-text question + Creator property editors via the host `IRichTextEditorAdapter`.
- Optional GPX (Leaflet) and Video question types behind feature flags.
- Readonly mobile package with an "Open on web" fallback for unsupported question types.
- Mercure-driven realtime topics: `surveys/{surveyId}/editing` for collaborative editing and `surveys/{surveyId}/responses` for live response streams.
- Health-check endpoint + service id `humdek.surveyjs.health_check`.
- Admin-only license-key endpoint (env var `SURVEYJS_LICENSE_KEY`).

# SurveyJS plugin — Manual QA Scenarios

Audience: Developers and technical operators.
Status: active.
Applies to: SelfHelp2 SurveyJS plugin (sh2-shp-survey-js).
Last verified: 2026-06-24.
Source of truth: Runtime code, configuration, and tests in this repository.

This document captures the manual QA scenarios that the legacy
`sh-shp-survey_js` plugin was validated against and that the new
`sh2-shp-survey-js` plugin must continue to pass. Each scenario
includes preconditions, steps, and the expected behaviour.

Automated coverage:

- Backend unit tests: `cd backend && composer test` (PHPUnit).
- Backend static analysis: `cd backend && composer phpstan`.
- Frontend type-check: `cd frontend && npm run typecheck`.
- Frontend unit tests: `cd frontend && npm test` (requires `npm install --save-dev vitest jsdom`).
- Mobile package: `cd mobile && npm run typecheck && npm test` (vitest) — covers the
  typed bridge contract, the runtime controller driven by real `survey-core`, the
  host-services API client, registration parity, and the WebView navigation
  security guard.

## 1. Submission lifecycle

### 1.1 Authenticated submission

1. Sign in as a regular user.
2. Open a published survey page.
3. Complete every required question and click _Complete_.
4. Verify a new row appears in `survey_runs` with the user's id,
   `status = completed`, and a non-null `completed_at`.
5. Verify each answer is materialised in the host `dataTables` row
   with the SurveyJS question name as the column.

### 1.2 Anonymous submission

1. Sign out (or open in an incognito window).
2. Open the same survey.
3. Observe a `_sh_sjs_vid` cookie is issued by the server.
4. Submit the survey.
5. Verify the new `survey_runs` row has `id_users = NULL` and the
   `visitor_id` matches the cookie payload.

### 1.3 Once-per-user (authenticated)

1. Submit a survey under user `A`.
2. Re-open the survey as user `A`.
3. Expect the "already submitted" Markdown label to render instead
   of the questions.
4. Switch to user `B`, re-open: full survey renders.

### 1.4 Once-per-visitor (anonymous)

1. Submit a survey from an incognito window.
2. Without clearing cookies, navigate back to the survey URL.
3. Expect the "already submitted" Markdown label.
4. Clear the cookie or open a different browser profile: full
   survey renders again (legacy parity — anonymous "once-per-user"
   is best-effort).

### 1.5 Edit-mode (`?record_id=`)

1. Submit a survey, capture the response id from `survey_runs`.
2. Re-open with `?record_id=<id>` and (when applicable) sign in as
   the original submitter.
3. Existing answers are pre-populated.
4. Modify an answer and re-submit.
5. The `survey_runs` row is updated in place; no new row is created.

## 2. Auto-save and timeout

### 2.1 Auto-save persistence

1. Set the survey's `auto_save_interval` to 5 seconds.
2. Open the survey and answer the first page.
3. Wait 6 seconds, then reload.
4. The page restarts at the last saved page with the saved values
   filled in.

### 2.2 Cross-device draft resume

1. Sign in as user `A` on browser 1.
2. Answer page 1 of a multi-page survey, advance to page 2.
3. Sign in as user `A` on browser 2 and open the same survey.
4. The draft from browser 1 is resumed on browser 2.

### 2.3 Restart on refresh

1. Toggle `restart_on_refresh = true` on the section.
2. Answer page 1, reload.
3. The survey restarts from the beginning with no saved values.

### 2.4 Timeout enforcement

1. Set `timeout = 1` minute.
2. Open the survey.
3. Wait 65 seconds.
4. The runtime locks the form and displays the timeout message.
5. Reload: the timeout state persists until the operator clears
   it (back-end blocks re-submission inside the timeout window).

### 2.5 Schedule (`start_time` / `end_time`)

1. Set `start_time = 23:59`, `end_time = 23:58` (closed window).
2. Open the survey.
3. The "Not active" Markdown label renders instead of the form.

## 3. File pipeline

### 3.1 Upload + answer payload

1. Add a `file` question to a survey.
2. Upload a small PNG.
3. The answer cell contains `{ id, url, filename, mimeType,
   sizeBytes, sha256 }` (no base64).
4. The file lives under `var/plugin-data/sh2-shp-survey-js/uploads/`.

### 3.2 Signed download

1. Right-click the file link in the response, copy the URL.
2. Paste it in an incognito window.
3. Expect `403` because the signature identity does not match.
4. Sign in as the original uploader / admin: the file streams.

### 3.3 Delete

1. As the original uploader (or admin), delete the response.
2. The file is removed from disk and `survey_files` row is GONE.

### 3.4 GPX question

1. Enable the `gpx` feature flag.
2. Add a GPX question to a survey.
3. Upload a `.gpx` file with a `<trkpt>` segment.
4. The Leaflet preview renders, distance is displayed.
5. The answer contains `sampledPoints` + `distanceMeters` + the
   file pointer.

### 3.5 Video question (required watch)

1. Enable the `video` feature flag.
2. Add a video question with `mandatoryWatch = true` and a 10 s
   segment.
3. Attempt to advance the page without watching: SurveyJS shows
   an error.
4. Watch the segment, then advance: the page progresses.

### 3.6 Microphone question

1. Enable the `microphone` feature flag.
2. Record a short clip.
3. The answer contains `{ url, durationMs, mimeType }` and the
   playback element streams the uploaded recording.

## 4. Dashboard

### 4.1 Tabulator table

1. Open the Dashboard tab for a survey with ≥ 1 response.
2. The table shows internal columns + one column per question.
3. Filter by `status = completed`: only completed rows remain.
4. Re-order a column, reload: the order persists.

### 4.2 Charts panel

1. With `survey-analytics` installed, switch to the Charts tab.
2. Each question gets a visualiser (bar / pie / wordcloud).

### 4.3 Realtime updates

1. Open the Dashboard in one tab.
2. Submit a response from another tab / device.
3. The table refreshes without manual reload.

### 4.4 Versions tab

1. Publish two versions of a survey.
2. The Versions tab lists both with timestamps + SHA-256.
3. Restore the older version: a new revision is created with the
   restored definition.

## 5. Export

### 5.1 CSV

1. Click Export → CSV.
2. The browser downloads `<surveyId>_<timestamp>.csv` with UTF-8
   BOM and a row per response.

### 5.2 XLSX

1. With `phpoffice/phpspreadsheet` installed, click Export → Excel.
2. The browser downloads a real `.xlsx`.
3. Without the package, the endpoint returns a 501 with an
   actionable message — the admin UI surfaces the error.

### 5.3 JSON

1. Click Export → JSON.
2. The download contains `{ surveyId, name, responses: [...] }`.

### 5.4 Per-response PDF

1. Click the download icon next to a response.
2. With `dompdf/dompdf` installed, the browser downloads a PDF.
3. Without it, the browser opens an HTML page with a banner that
   tells the operator to use _Print → Save as PDF_.

### 5.5 Runtime Save-as-PDF

1. Enable `save_pdf = true` on the section.
2. With `survey-pdf` installed + a license key, the runtime adds
   a "Save as PDF" nav button that downloads the rendered survey.
3. Without the package, the button invokes `window.print()` so the
   user can still _Save as PDF_ from the print dialog.

## 6. Realtime

### 6.1 Collaborative-edit presence

1. Open the Designer tab as user `A`.
2. Open the same Designer tab as user `B`.
3. Each user sees the other in the presence list.

### 6.2 Live response feed

1. Open the Responses tab.
2. Submit a response in another browser.
3. The list refreshes without polling.

## 7. Mobile (WebView renderer)

The mobile renderer hosts the official SurveyJS runtime inside a
self-contained WebView (`react-native-webview` on native, an iframe on
the Expo web export) driven by the typed host-services bridge. Each
behaviour leg below is also covered by an automated test, listed under
the scenario.

### 7.1 REQUIRED — CMS mobile-preview acceptance smoke (release gate)

This is the gating acceptance for every mobile renderer release. Run it
in the CMS mobile preview (the `selfhelp-mobile-preview` image bundling
`@selfhelp/sh2-shp-survey-js-mobile` at the published version) after the
package is on npm and the preview image is rebuilt.

Preconditions:

- A published survey on a page hosting a `surveyjs` section, with a
  required question and a `redirect at end` keyword configured.
- The preview snapshot advertises `mobileRendererVersion: 0.2.0` and the
  SurveyJS entry (see `web-preview/preview-plugins.json`).

Steps + expected behaviour:

1. Open the page in CMS mobile preview. The survey renders inside the
   WebView (NOT the "Open on web" card).
2. Click _Complete_ with the required question empty → SurveyJS shows a
   validation error and does **not** submit.
3. Fill every required question and click _Complete_.
4. A **real** `survey_runs` row is created (`status = completed`,
   non-null `completed_at`) and answers materialise in the host
   `data_tables` row — identical to a web submission (there is no
   preview/test branch on the backend).
5. The SurveyJS completion screen shows.
6. The configured redirect is followed.

Automated coverage of each leg (runs in CI, no live stack):

- Fill → validate-gate → completion → `SUBMIT_SURVEY` intent →
  `SUBMIT_RESULT` → `REQUEST_REDIRECT`:
  `mobile/__tests__/runtime/controller.test.ts` (drives the real
  `survey-core` model headlessly).
- `SUBMIT_SURVEY` → native host → `POST .../submit` (correct route,
  envelope unwrap, session-expiry mapping):
  `mobile/__tests__/api/hostApi.test.ts`.
- `/submit` stores a real `SurveyRun` regardless of origin / preview
  hints: `backend/tests/Service/SurveyResponseServiceTest.php`
  (`testMobileOriginSubmitStoresRealRunAndIgnoresPreviewHints`).
- The preview snapshot bundles SurveyJS at the renderer contract:
  `sh-selfhelp_mobile/__tests__/unit/pluginHostServices.test.mjs`.

The live run remains required because only an end-to-end CMS preview
exercises the published npm package + rebuilt image + real browser
WebView together.

### 7.2 WebView security

1. The WebView only loads the bundled self-contained runtime document;
   any attempt to navigate it to an external/remote URL is blocked
   (`onShouldStartLoadWithRequest` → `isAllowedWebViewUrl`). The native
   transport scopes `originWhitelist` to `about:blank` (not `*`),
   disables DOM storage, and disables multiple windows; the web-export
   iframe is sandboxed and the runtime HTML carries a strict CSP
   (`connect-src 'none'`).
   - Automated: `mobile/__tests__/security/webviewNavigation.test.ts`.
2. The bridge accepts only typed messages matching the expected shape;
   malformed / wrong-source / wrong-direction / hostile payloads are
   dropped.
   - Automated: `mobile/__tests__/bridge/messages.test.ts`.
3. External redirects never happen via WebView navigation — the runtime
   emits `REQUEST_REDIRECT` and the native host performs the navigation
   (`Linking.openURL` for external), so an off-origin jump requires
   native-host action, not WebView self-navigation.

### 7.3 Missing / incompatible package fallback

1. Install a plugin whose `compatibility.mobile` the app's mobile
   renderer version does not satisfy (or omit the mobile package).
2. The page renders with the `OpenOnWebFallback` card for the `surveyjs`
   section (the ONLY legitimate open-on-web case).
3. Other sections on the page keep rendering natively.

### 7.4 Session expiry mid-survey

1. Start a long survey on the mobile app; let the access token expire.
2. On save/submit the native host refreshes the token once and retries;
   the survey continues without losing answers (autosave) when enabled.
3. If the refresh fails, the shell shows a "session expired" notice and
   a retry after re-authentication. The WebView never sees the token.

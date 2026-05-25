# SurveyJS plugin — Manual QA Scenarios

This document captures the manual QA scenarios that the legacy
`sh-shp-survey_js` plugin was validated against and that the new
`sh2-shp-survey-js` plugin must continue to pass. Each scenario
includes preconditions, steps, and the expected behaviour.

Automated coverage:

- Backend unit tests: `cd backend && composer test` (PHPUnit).
- Backend static analysis: `cd backend && composer phpstan`.
- Frontend type-check: `cd frontend && npm run typecheck`.
- Frontend unit tests: `cd frontend && npm test` (requires `npm install --save-dev vitest jsdom`).

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

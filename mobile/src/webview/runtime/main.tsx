/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * WebView runtime entry point. Bundled by `vite.webview.config.ts` together
 * with SurveyJS JS + CSS into a single self-contained HTML asset (no CDN).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'survey-core/survey-core.css';
import './runtime.css';
import { SurveyWebviewApp } from './SurveyWebviewApp';

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <StrictMode>
            <SurveyWebviewApp />
        </StrictMode>,
    );
}

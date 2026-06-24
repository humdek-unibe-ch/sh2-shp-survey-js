/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * tsup build for `@selfhelp/sh2-shp-survey-js-mobile`.
 *
 * Everything the host already provides (react / react-native /
 * @selfhelp/shared) and the heavy SurveyJS runtime (survey-core,
 * survey-react-ui — pulled in transitively as runtime `dependencies`)
 * stay EXTERNAL. The host bundler (Expo Metro for the web export, EAS
 * for native) resolves them from `node_modules`, so the published dist
 * keeps the `import('survey-react-ui')` / `import('survey-core/...css')`
 * specifiers intact instead of inlining a second copy of SurveyJS.
 *
 * The regex externals also catch CSS subpaths (`survey-core/survey-core.css`)
 * so esbuild never tries to parse a stylesheet without a loader.
 */
// @ts-expect-error -- tsup is an optional devDependency resolved once `npm install` has run.
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: false,
    external: [
        /^react$/,
        /^react-dom/,
        /^react-native$/,
        /^@selfhelp\/shared/,
        /^survey-core/,
        /^survey-react-ui/,
    ],
});

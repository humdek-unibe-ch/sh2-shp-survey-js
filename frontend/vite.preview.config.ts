/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * Vite config for the theme test page (`npm run dev:theme`).
 *
 * Unlike `vite.config.ts` it does not redirect React and Mantine to a
 * SelfHelp host: the page brings its own copies and runs with nothing
 * else started. It is a development tool and is not part of the plugin
 * bundle.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    root: 'preview',
    cacheDir: '../node_modules/.vite-preview',
    server: {
        port: 5175,
        strictPort: true,
    },
});

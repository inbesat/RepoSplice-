// P-233 — Playwright configuration for the end-to-end flow.
//
// DEVIATION (ADR-118): the spec asked for a `stitch serve --fixtures` web
// server. `stitch serve` exists but has no --fixtures flag and serves none of
// the web app's endpoints, so the suite boots the web app's own Vite dev
// server and intercepts every /api/** call in the browser (e2e/helpers.ts).
// Same app, same code paths — only the server is stubbed.
//
// P-237 — the perf budgets run in their OWN config
// (playwright.perf.config.ts) because Playwright's `webServer` is a
// top-level option: a perf project inside this file would drag the preview
// server into every e2e run, and the preview server needs a build.

import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

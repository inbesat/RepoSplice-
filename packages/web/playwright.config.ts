// P-233 — Playwright configuration.
//
// DEVIATION (ADR-118): the spec asked for a `stitch serve --fixtures` web
// server. `stitch serve` exists but has no --fixtures flag and serves none of
// the web app's endpoints, so the suite boots the web app's own Vite dev
// server and intercepts every /api/** call in the browser (e2e/helpers.ts).
// Same app, same code paths — only the server is stubbed.

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

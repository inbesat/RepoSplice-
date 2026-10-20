// P-237 — the perf budget config. Separate from playwright.config.ts because
// Playwright's `webServer` is a top-level option: keeping the preview server
// in its own config lets the e2e suite stay build-free while the perf
// numbers come from the PRODUCTION bundle (vite preview).
//
// Run: `bun run test:perf` (requires `bun run build` first — the CI perf job
// builds before this runs).

import { defineConfig, devices } from '@playwright/test';

const PORT = 5175;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './perf',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bunx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

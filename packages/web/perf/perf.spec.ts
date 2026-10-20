// P-237 — the perf gate. Three budgets, measured for real:
//   'initial bundle budget' — the built dist on disk (gzip of the initial JS).
//   'shell lcp'             — the LCP of the built shell in a real browser.
//   'tree scroll smooth'    — the frame budget while the 100k-node tree
//                             scrolls (P-232's virtualized tree).
//
// The perf project serves the BUILT app (vite preview) so the numbers are
// production-representative; the e2e project keeps using the dev server.

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INITIAL_JS_BUDGET_BYTES, measureInitialBundle } from '../scripts/budget.js';
import { addLocalSource, installTourOptOut } from '../e2e/helpers.js';

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** The shell must paint within this budget (P-237 AC). */
const LCP_BUDGET_MS = 2500;

/** The p95 frame delta budget while the tree scrolls (P-237 AC). */
const FRAME_P95_BUDGET_MS = 120;

/** The tree fixture: 100k files in one directory. */
const BIG_TREE = {
  entries: Array.from({ length: 100_000 }, (_, index) => ({
    path: `file-${index}.ts`,
    type: 'file',
    size: 128,
  })),
};

/** Serve the API the app needs while the tree renders. */
async function installBigTreeApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route(
    url => url.pathname.startsWith('/api/'),
    async route => {
      const { pathname } = new URL(route.request().url());
      const body = (() => {
        if (pathname === '/api/repos/sources') return { sources: [] };
        if (pathname === '/api/repos/local')
          return { id: 'r1', kind: 'local', path: '/tmp/rA', status: 'ready' };
        if (pathname.endsWith('/tree')) return BIG_TREE;
        if (pathname === '/api/deps/report') return { conflicts: [], resolved: [] };
        if (pathname === '/api/licenses/report') return { entries: [], decisions: {} };
        if (pathname === '/api/settings') return { theme: 'auto' };
        if (pathname === '/api/provenance/credits') return { credits: [] };
        if (pathname === '/api/sandbox/capabilities') return { available: false };
        if (pathname.startsWith('/api/sandbox/result/')) return { status: 'succeeded' };
        if (pathname === '/api/jobs') return { jobs: [] };
        return {};
      })();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    }
  );
}

test('initial bundle budget', () => {
  const bundle = measureInitialBundle(DIST_DIR);
  console.log(
    `initial JS: ${(bundle.totalGzipBytes / 1024).toFixed(1)} kB gzip ` +
      `(budget ${(INITIAL_JS_BUDGET_BYTES / 1024).toFixed(0)} kB)`
  );
  expect(bundle.chunks.length).toBeGreaterThan(0);
  expect(bundle.totalGzipBytes).toBeLessThanOrEqual(INITIAL_JS_BUDGET_BYTES);
});

test('shell lcp', async ({ page }) => {
  // The API is stubbed so the shell paints its real content (and the dev
  // proxy never tries to reach a serve process that is not running).
  await installBigTreeApi(page);
  await page.addInitScript(() => {
    const scope = window as unknown as { __lcp: number };
    scope.__lcp = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) scope.__lcp = entry.startTime;
    }).observe({
      type: 'largest-contentful-paint',
      buffered: true,
    } as PerformanceObserverInit);
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
  console.log(`shell LCP: ${lcp.toFixed(0)} ms (budget ${LCP_BUDGET_MS} ms)`);
  expect(lcp).toBeGreaterThan(0);
  expect(lcp).toBeLessThanOrEqual(LCP_BUDGET_MS);
});

test('tree scroll smooth', async ({ page }) => {
  await installTourOptOut(page);
  await installBigTreeApi(page);
  await page.addInitScript(() => {
    const scope = window as unknown as { __frames: number[] };
    scope.__frames = [];
    let last = performance.now();
    const tick = (now: number) => {
      scope.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.goto('/sources');
  // Both slots are needed before the flow advances to Select (P-212 gate).
  await addLocalSource(page, 'A', 'a');
  await addLocalSource(page, 'B', 'b');
  await page.waitForURL('**/select');

  // Both slots are filled, so Select shows a tree per slot — scope to the
  // first one for the scroll measurement.
  const tree = page.getByRole('tree', { name: 'File tree' }).first();
  await tree.waitFor();
  await page.waitForTimeout(500);

  // Scroll the virtualized tree deep into the 100k rows.
  const box = await tree.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 200_000);
  await page.waitForTimeout(1000);

  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  expect(frames.length).toBeGreaterThan(10);
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  console.log(`tree scroll frame p95: ${p95.toFixed(1)} ms (budget ${FRAME_P95_BUDGET_MS} ms)`);
  expect(p95).toBeLessThanOrEqual(FRAME_P95_BUDGET_MS);

  // The tree still renders a slice (rows are recycled, not all mounted).
  const rows = await page.getByRole('treeitem').count();
  console.log(`tree rows mounted after scroll: ${rows}`);
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(500);
});

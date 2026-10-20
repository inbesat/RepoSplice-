// P-233 — E2E helpers: the fixture repos on disk plus the /api/** interceptor.
//
// DEVIATION (ADR-118): the spec's `stitch serve --fixtures` web server cannot
// back these specs — `stitch serve` exists but has no --fixtures flag and
// serves none of the web app's endpoints (/api/repos/*, /api/merge/*, ...).
// Instead the suite boots the web app's own Vite dev server (playwright.config)
// and answers every /api/** call in the browser with fixtures. The app under
// test is the real one; only the server is stubbed. When the serve lane lands
// the interceptor can be dropped and the specs become the acceptance run.
//
// The tree entries are DERIVED from the fixture directories with node:fs, so
// the fixture repos stay the single source of truth (no hand-written JSON
// that can drift from the files on disk).

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Route } from '@playwright/test';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Root of the committed fixture repos. */
export const FIXTURE_ROOT = join(HERE, 'fixtures', 'repos');

/** Absolute path of fixture repo A / B (what the picker adds as a local source). */
export const FIXTURE_PATH = {
  a: join(FIXTURE_ROOT, 'a'),
  b: join(FIXTURE_ROOT, 'b'),
} as const;

export interface FixtureEntry {
  readonly path: string;
  readonly type: 'file' | 'dir';
  readonly size: number;
}

/** Read one fixture repo as the flat entry list `/api/repos/:id/tree` returns. */
export function readFixtureTree(repo: 'a' | 'b'): FixtureEntry[] {
  const root = FIXTURE_PATH[repo];
  const entries: FixtureEntry[] = [];
  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const full = join(dir, name);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      const relative = prefix === '' ? name : `${prefix}/${name}`;
      if (stats.isDirectory()) {
        entries.push({ path: relative, type: 'dir', size: 0 });
        walk(full, relative);
      } else {
        entries.push({ path: relative, type: 'file', size: stats.size });
      }
    }
  };
  walk(root, '');
  return entries;
}

interface SourceFixture {
  id: string;
  kind: 'local' | 'github';
  path?: string;
  repo?: string;
  ref?: string;
  status: 'ready';
}

/** The onboarding tour auto-queues itself on a first visit (P-229). */
export const TOUR_KEY = 'stitch-tour';
export const TOUR_AUTOSTART_KEY = 'stitch-tour-auto';

/**
 * Opt the browser out of the auto-queued tour: it renders a full-screen
 * overlay that would swallow every click in the flow specs.
 */
export async function installTourOptOut(page: Page): Promise<void> {
  await page.addInitScript(
    ([tourKey, autoKey]) => {
      window.localStorage.setItem(tourKey, JSON.stringify({ dismissed: true, completed: true }));
      window.localStorage.setItem(autoKey, '1');
    },
    [TOUR_KEY, TOUR_AUTOSTART_KEY] as const
  );
}

const json = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

/**
 * Answer every /api/** call the web app makes with deterministic fixtures.
 * Unknown endpoints answer 404 with a message so a gap shows up as a visible
 * failure instead of a hang.
 */
export async function installApiFixtures(page: Page): Promise<void> {
  const sources = new Map<string, SourceFixture>();
  const repoOf = new Map<string, 'a' | 'b'>();
  let counter = 0;

  await page.route(
    // Only the app's own API namespace — a `**/api/**` glob would also
    // swallow Vite's module URLs (`/src/api/...`) and blank the app.
    url => url.pathname.startsWith('/api/'),
    async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      if (path === '/api/repos/sources' && method === 'GET') {
        await json(route, { sources: [] });
        return;
      }
      if (path === '/api/repos/local' && method === 'POST') {
        const body = (JSON.parse(request.postData() ?? '{}') ?? {}) as { path?: string };
        const target = body.path ?? '';
        counter += 1;
        const id = `local-${counter}`;
        const repo = target.includes('repos\\b') || target.endsWith('/b') ? 'b' : 'a';
        sources.set(id, { id, kind: 'local', path: target, status: 'ready' });
        repoOf.set(id, repo);
        await json(route, { id, kind: 'local', path: target, status: 'ready' });
        return;
      }
      if (path === '/api/repos/from-url' && method === 'POST') {
        const body = (JSON.parse(request.postData() ?? '{}') ?? {}) as {
          ownerRepo?: string;
          ref?: string;
        };
        counter += 1;
        const id = `github-${counter}`;
        const record: SourceFixture = {
          id,
          kind: 'github',
          repo: body.ownerRepo ?? 'unknown/repo',
          ...(body.ref !== undefined ? { ref: body.ref } : {}),
          status: 'ready',
        };
        sources.set(id, record);
        await json(route, record);
        return;
      }
      if (path.startsWith('/api/repos/') && path.endsWith('/tree') && method === 'GET') {
        const id = decodeURIComponent(path.slice('/api/repos/'.length, -'/tree'.length));
        const repo = repoOf.get(id);
        await json(route, { entries: repo === undefined ? [] : readFixtureTree(repo) });
        return;
      }
      if (path === '/api/merge' && method === 'POST') {
        await json(route, { files: 2, deps: [], licenses: [] });
        return;
      }
      if (path === '/api/merge/proposed-diff' && method === 'GET') {
        await json(route, {
          files: [
            {
              path: 'src/index.ts',
              kind: 'modify',
              oldText: 'export const beta = 1;\n',
              newText: 'export const beta = 2;\n',
            },
          ],
        });
        return;
      }
      if (path === '/api/merge/approve' && method === 'POST') {
        await json(route, { files: 2, deps: [], licenses: [] });
        return;
      }
      if (path === '/api/merge/reject' && method === 'POST') {
        await json(route, { ok: true });
        return;
      }
      if (path === '/api/settings') {
        await json(route, {});
        return;
      }
      if (path === '/api/session/export' && method === 'GET') {
        await json(route, {
          version: 1,
          exportedAt: '2026-10-20T00:00:00.000Z',
          sources: { A: [], B: [] },
          selection: { A: [], B: [] },
          resolutions: {},
          licenseDecisions: {},
        });
        return;
      }
      if (path === '/api/session/import' && method === 'POST') {
        await json(route, { warnings: [] });
        return;
      }
      await json(route, { message: `no E2E fixture for ${method} ${path}` }, 404);
    }
  );
}

/** Add one local fixture source to a picker slot. */
export async function addLocalSource(page: Page, slot: 'A' | 'B', repo: 'a' | 'b'): Promise<void> {
  const form = page.getByRole('form', { name: `add source ${slot}` });
  const path = FIXTURE_PATH[repo];
  await form.getByRole('tab', { name: 'Local path' }).click();
  const input = form.getByLabel('local path');
  await input.fill(path);
  await expect(input).toHaveValue(path);
  await form.getByRole('button', { name: 'Add source' }).click();
  const list = page.getByRole('list', { name: `known sources ${slot}` });
  // Either the slot lists the source, or (filling the LAST slot) the app
  // advanced to Select, which unmounts the picker.
  await Promise.race([
    list.locator('li').first().waitFor({ timeout: 15_000 }),
    page.waitForURL('**/select', { timeout: 15_000 }),
  ]);
}

/** Expand the 'src' directory of every tree that has one (idempotent). */
async function expandSrcTrees(page: Page): Promise<void> {
  const trees = page.getByRole('tree');
  const count = await trees.count();
  for (let index = 0; index < count; index += 1) {
    const tree = trees.nth(index);
    // An expanded tree already shows its files — leave it alone.
    if ((await tree.getByRole('checkbox', { name: 'src/alpha.ts' }).count()) > 0) continue;
    if ((await tree.getByRole('checkbox', { name: 'src/beta.ts' }).count()) > 0) continue;
    const toggle = tree.getByRole('button', { name: 'Toggle src' });
    if ((await toggle.count()) === 0) continue;
    await toggle.first().click();
  }
}

/** Check one file in each tree — the trees load independently, so retry. */
export async function selectOneFilePerSlot(page: Page): Promise<void> {
  const alpha = page.getByRole('checkbox', { name: 'src/alpha.ts' });
  const beta = page.getByRole('checkbox', { name: 'src/beta.ts' });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await expandSrcTrees(page);
    if ((await alpha.count()) > 0 && (await beta.count()) > 0) break;
    await page.waitForTimeout(400);
  }
  await alpha.check();
  await beta.check();
}

// P-178 — install layer cache tests.
//
// Hashing runs against real temp workspaces (so a manifest/lockfile change is a
// real file change, not a mocked one), the cache runs against the same
// `node:sqlite`-backed `DbLike` adapter the P-169/P-173 suites use, and the
// container client is a fake — so no daemon and no package manager ever run.
//
// The six required scenarios from the phase spec:
//
//   it('computes stable key')        it('changes key on lockfile change')
//   it('hit skips install')          it('miss installs and records')
//   it('evicts via clear')           it('logs hit/miss')

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ok } from 'neverthrow';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../store/schema.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import { installDeps, type InstallClient } from './install.js';
import { runVerification } from './runner.js';
import {
  SandboxCache,
  cacheKey,
  clearCacheForTests,
  restoreCache,
  saveCache,
  type CacheEvent,
} from './cache.js';

/** In-memory DbLike (the P-145/P-160 test adapter pattern, local to this suite). */
function makeAdapter(): DbLike {
  const raw = new DatabaseSync(':memory:');
  const toInput = (p: SQLiteValue[]): (string | number | bigint | null | Uint8Array)[] =>
    p.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const wrap = (stmt: {
    all(...p: (string | number | bigint | null | Uint8Array)[]): Record<string, unknown>[];
    get(
      ...p: (string | number | bigint | null | Uint8Array)[]
    ): Record<string, unknown> | undefined;
    run(...p: (string | number | bigint | null | Uint8Array)[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }): StatementLike => ({
    all: (...p) => stmt.all(...toInput(p)) as SQLiteRow[],
    get: (...p) => (stmt.get(...toInput(p)) as SQLiteRow | undefined) ?? null,
    run: (...p) => {
      const r = stmt.run(...toInput(p));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  });
  return {
    exec: sql => raw.exec(sql),
    query: sql => wrap(raw.prepare(sql)),
    close: () => raw.close(),
  };
}

interface FakeOutcome {
  exitCode?: number;
  stdout?: string[];
  stderr?: string[];
}

function makeFakeClient(outcome: FakeOutcome = {}): {
  client: InstallClient;
  calls: { specs: ContainerSpec[]; options: (RunOptions | undefined)[] };
} {
  const calls = { specs: [] as ContainerSpec[], options: [] as (RunOptions | undefined)[] };
  const client: InstallClient = {
    async run(spec: ContainerSpec, opts?: RunOptions) {
      calls.specs.push(spec);
      calls.options.push(opts);
      const ran: ContainerRun = {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? [],
        stderr: outcome.stderr ?? [],
        durationMs: 7,
      };
      return ok(ran);
    },
  };
  return { client, calls };
}

let root: string;
const FIXED_NOW = '2026-10-16T00:00:00.000Z';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-cache-'));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  // The no-db fallback is module-level state; keep suites independent.
  clearCacheForTests();
});

/** A workspace dir with the given relative-path → content files. */
async function makeWorkspace(name: string, files: Record<string, string> = {}): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return dir;
}

const NODE_FILES = { 'package.json': '{"name":"a"}\n', 'bun.lock': 'lock-1\n' };

describe('P-178 cacheKey', () => {
  it('computes stable key', async () => {
    const dir = await makeWorkspace('stable', NODE_FILES);
    const twin = await makeWorkspace('stable-twin', NODE_FILES);

    const first = await cacheKey('node', dir);
    const second = await cacheKey('node', dir);
    const other = await cacheKey('node', twin);

    expect(first.isOk()).toBe(true);
    if (first.isOk() && second.isOk() && other.isOk()) {
      expect(first.value).toMatch(/^[0-9a-f]{64}$/);
      // Same content ⇒ same key, twice.
      expect(second.value).toBe(first.value);
      // Content-addressed, not path-addressed: an identical workspace elsewhere
      // must hit the same entry.
      expect(other.value).toBe(first.value);
    }

    // A different ecosystem is a different key, even with the same (absent) files.
    const rust = await cacheKey('rust', dir);
    if (first.isOk() && rust.isOk()) expect(rust.value).not.toBe(first.value);

    // A manifest change moves it.
    const manifestChanged = await makeWorkspace('stable-manifest', {
      ...NODE_FILES,
      'package.json': '{"name":"b"}\n',
    });
    const changed = await cacheKey('node', manifestChanged);
    if (first.isOk() && changed.isOk()) expect(changed.value).not.toBe(first.value);

    // A blank path is a typed config error, not a silent empty hash.
    const blank = await cacheKey('node', '   ');
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('changes key on lockfile change', async () => {
    const dir = await makeWorkspace('lock', NODE_FILES);
    const before = await cacheKey('node', dir);
    await writeFile(join(dir, 'bun.lock'), 'lock-2\n', 'utf8');
    const after = await cacheKey('node', dir);

    expect(before.isOk() && after.isOk()).toBe(true);
    if (before.isOk() && after.isOk()) {
      // The lockfile is the primary invalidation signal (phase acceptance).
      expect(after.value).not.toBe(before.value);
    }

    // Opting the lockfile OUT makes the same edit a no-op — proof the change
    // above came from the lockfile and not from incidental drift.
    const unlockedBefore = await cacheKey('node', dir, { includeLock: false });
    await writeFile(join(dir, 'bun.lock'), 'lock-3\n', 'utf8');
    const unlockedAfter = await cacheKey('node', dir, { includeLock: false });
    if (unlockedBefore.isOk() && unlockedAfter.isOk()) {
      expect(unlockedAfter.value).toBe(unlockedBefore.value);
    }
  });

  it('gates the full-tree key', async () => {
    const dir = await makeWorkspace('gate', { ...NODE_FILES, 'src/a.ts': 'const a = 1;\n' });

    // Refused, not silently downgraded: a weaker key would keep serving entries
    // the caller explicitly asked not to trust.
    const refused = await cacheKey('node', dir, { includeFiles: true });
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) {
      expect(refused.error.code).toBe('CONFIG_ERROR');
      expect('field' in refused.error && refused.error.field).toBe('includeFiles');
    }

    const before = await cacheKey('node', dir, { includeFiles: true, fullTreeAllowed: true });
    expect(before.isOk()).toBe(true);

    await writeFile(join(dir, 'src/a.ts'), 'const a = 2;\n', 'utf8');
    const after = await cacheKey('node', dir, { includeFiles: true, fullTreeAllowed: true });
    if (before.isOk() && after.isOk()) expect(after.value).not.toBe(before.value);

    // A caller-supplied shortlist needs no gate: the caller already bounded it.
    const shortA = await cacheKey('node', dir, { includeFiles: ['src/a.ts'] });
    expect(shortA.isOk()).toBe(true);
    await writeFile(join(dir, 'src/a.ts'), 'const a = 3;\n', 'utf8');
    const shortB = await cacheKey('node', dir, { includeFiles: ['src/a.ts'] });
    if (shortA.isOk() && shortB.isOk()) expect(shortB.value).not.toBe(shortA.value);

    // A file that is legitimately absent contributes a stable marker.
    const withMissing = await cacheKey('node', dir, { includeFiles: ['src/nope.ts'] });
    const withMissingAgain = await cacheKey('node', dir, { includeFiles: ['src/nope.ts'] });
    if (withMissing.isOk() && withMissingAgain.isOk()) {
      expect(withMissingAgain.value).toBe(withMissing.value);
    }
  });

  it('ignores install output in a full-tree key', async () => {
    const dir = await makeWorkspace('ignore', { ...NODE_FILES, 'src/a.ts': 'const a = 1;\n' });
    const before = await cacheKey('node', dir, { includeFiles: true, fullTreeAllowed: true });
    expect(before.isOk()).toBe(true);

    // The install itself writes node_modules. If that moved the key, the next run
    // would miss forever — the trap the ignore list exists to prevent.
    await makeWorkspace('ignore/node_modules/pkg', { 'index.js': 'module.exports = 1;\n' });
    await makeWorkspace('ignore/target', { 'artifact.bin': 'binary' });

    const after = await cacheKey('node', dir, { includeFiles: true, fullTreeAllowed: true });
    if (before.isOk() && after.isOk()) expect(after.value).toBe(before.value);
  });
});

describe('P-178 SandboxCache', () => {
  it('hit skips install', async () => {
    const dir = await makeWorkspace('hit', NODE_FILES);
    const cache = new SandboxCache({ db: makeAdapter(), now: () => FIXED_NOW });
    const recorded = await cache.put('node', dir, { imageTag: 'stitch-node:stitch-ephemeral-abc' });
    expect(recorded.isOk()).toBe(true);

    const { client, calls } = makeFakeClient();
    const result = await installDeps('node', dir, { cache }, client);

    // The whole point: no container was created.
    expect(calls.specs).toHaveLength(0);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.cached).toBe(true);
      expect(result.value.installed).toBe(false);
      expect(result.value.command).toBe('(cached)');
      expect(result.value.image).toBe('stitch-node:stitch-ephemeral-abc');
      expect(result.value.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('miss installs and records', async () => {
    const dir = await makeWorkspace('miss', NODE_FILES);
    const cache = new SandboxCache({ db: makeAdapter(), now: () => FIXED_NOW });
    const { client, calls } = makeFakeClient({ stdout: ['5 packages installed'] });

    const first = await installDeps('node', dir, { cache }, client);
    expect(calls.specs).toHaveLength(1);
    expect(first.isOk()).toBe(true);
    if (first.isOk()) {
      expect(first.value.cached).toBe(false);
      expect(first.value.installed).toBe(true);
      expect(first.value.image).toBe('oven/bun:1.1');
      expect(first.value.packageCount).toBe(5);
    }

    // The entry was recorded…
    const entries = await cache.entries();
    expect(entries.isOk()).toBe(true);
    if (entries.isOk()) {
      expect(entries.value).toHaveLength(1);
      expect(entries.value[0]?.ecosystem).toBe('node');
      expect(entries.value[0]?.imageTag).toBe('oven/bun:1.1');
      expect(entries.value[0]?.createdAt).toBe(FIXED_NOW);
    }

    // …so the same content installs only once.
    const second = await installDeps('node', dir, { cache }, client);
    expect(calls.specs).toHaveLength(1);
    expect(second.isOk() && second.value.cached).toBe(true);

    // A lockfile change is a miss again — and records the replacement.
    await writeFile(join(dir, 'bun.lock'), 'lock-2\n', 'utf8');
    const third = await installDeps('node', dir, { cache }, client);
    expect(calls.specs).toHaveLength(2);
    expect(third.isOk() && third.value.cached).toBe(false);
    const after = await cache.entries();
    if (after.isOk()) expect(after.value).toHaveLength(2);
  });

  it('evicts via clear', async () => {
    const dir = await makeWorkspace('evict', NODE_FILES);
    const cache = new SandboxCache({ db: makeAdapter(), now: () => FIXED_NOW });
    await cache.put('node', dir, { imageTag: 'img' });

    const before = await cache.get('node', dir);
    expect(before.isOk() && before.value.hit).toBe(true);

    const cleared = await cache.clear();
    expect(cleared.isOk()).toBe(true);
    if (cleared.isOk()) expect(cleared.value).toBe(1);

    const after = await cache.get('node', dir);
    expect(after.isOk() && after.value.hit).toBe(false);

    // Clearing an empty cache is not an error.
    const again = await cache.clear();
    if (again.isOk()) expect(again.value).toBe(0);
    const entries = await cache.entries();
    if (entries.isOk()) expect(entries.value).toEqual([]);
  });

  it('logs hit/miss', async () => {
    const dir = await makeWorkspace('logs', NODE_FILES);
    const events: CacheEvent[] = [];
    const cache = new SandboxCache({
      db: makeAdapter(),
      now: () => FIXED_NOW,
      onEvent: event => events.push(event),
    });

    await cache.get('node', dir); // miss
    await cache.put('node', dir, { imageTag: 'img' }); // saved
    await cache.get('node', dir); // hit

    expect(events.map(event => event.type)).toEqual(['miss', 'saved', 'hit']);
    expect(events[0]?.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0]?.ecosystem).toBe('node');
    expect(events[2]?.imageTag).toBe('img');

    // The sink also works without sqlite, so a caller can trace a cold cache.
    clearCacheForTests();
    const inMemory: CacheEvent[] = [];
    const memoryOnly = new SandboxCache({ onEvent: event => inMemory.push(event) });
    await memoryOnly.get('node', dir); // miss
    await memoryOnly.put('node', dir, { imageTag: 'img2' }); // saved
    await memoryOnly.get('node', dir); // hit
    expect(inMemory.map(event => event.type)).toEqual(['miss', 'saved', 'hit']);
    expect(inMemory[2]?.imageTag).toBe('img2');
  });
});

describe('P-178 cache wiring', () => {
  it('round-trips via restore/saveCache', async () => {
    const dir = await makeWorkspace('roundtrip', NODE_FILES);
    const cache = new SandboxCache({ db: makeAdapter(), now: () => FIXED_NOW });

    const empty = await restoreCache(cache, 'node', dir);
    expect(empty.isOk() && empty.value.hit).toBe(false);

    const saved = await saveCache(cache, 'node', dir, {
      imageTag: 'tag-x',
      command: 'bun install --frozen-lockfile',
    });
    expect(saved.isOk()).toBe(true);

    const restored = await restoreCache(cache, 'node', dir);
    if (restored.isOk()) {
      expect(restored.value.hit).toBe(true);
      expect(restored.value.imageTag).toBe('tag-x');
    }

    // A pre-supplied key is honoured (so a caller hashes the workspace once).
    const precomputed = await restoreCache(cache, 'node', dir, {
      cacheKey: restored.isOk() ? restored.value.cacheKey : 'nope',
    });
    expect(precomputed.isOk() && precomputed.value.hit).toBe(true);
  });

  it('degrades a broken cache to a cold install', async () => {
    const dir = await makeWorkspace('broken', NODE_FILES);
    const events: CacheEvent[] = [];
    const broken: DbLike = {
      exec: () => undefined,
      query: () => {
        throw new Error('db down');
      },
      close: () => undefined,
    };
    const cache = new SandboxCache({ db: broken, onEvent: event => events.push(event) });
    const { client, calls } = makeFakeClient();

    // A cache outage must never fail an install that would otherwise succeed.
    const result = await installDeps('node', dir, { cache }, client);
    expect(calls.specs).toHaveLength(1);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.installed).toBe(true);
      expect(result.value.cached).toBe(false);
    }
    expect(events.some(event => event.type === 'read-failed')).toBe(true);
  });

  it('runner reuses the cached image tag', async () => {
    const dir = await makeWorkspace('runner-cache', NODE_FILES);
    const cache = new SandboxCache({ db: makeAdapter(), now: () => FIXED_NOW });
    await cache.put('node', dir, { imageTag: 'stitch-node:stitch-ephemeral-runner' });

    const seen: string[] = [];
    const dockerClient: InstallClient = {
      async run(spec: ContainerSpec) {
        seen.push(spec.image);
        return ok({ exitCode: 0, stdout: [], stderr: [], durationMs: 1 });
      },
    };

    const result = await runVerification('build', 'node', dir, {
      dockerClient,
      selection: { dockerAvailable: true },
      cache: { cache },
    });

    expect(result.isOk()).toBe(true);
    // The image came from the cache, not from the ecosystem default.
    expect(seen).toEqual(['stitch-node:stitch-ephemeral-runner']);

    // A miss leaves the caller's image in place (no cached tag to use).
    const cold = new SandboxCache({ db: makeAdapter() });
    const coldSeen: string[] = [];
    const coldClient: InstallClient = {
      async run(spec: ContainerSpec) {
        coldSeen.push(spec.image);
        return ok({ exitCode: 0, stdout: [], stderr: [], durationMs: 1 });
      },
    };
    await runVerification('build', 'node', dir, {
      dockerClient: coldClient,
      image: 'explicit-image:1',
      selection: { dockerAvailable: true },
      cache: { cache: cold },
    });
    expect(coldSeen).toEqual(['explicit-image:1']);
  });
});

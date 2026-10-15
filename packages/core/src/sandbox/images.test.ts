// P-169 — ephemeral image resolution tests.
//
// The container client is a fake (`ImageClient`), so no daemon and no registry
// are touched: the tests assert the RESOLUTION decision (override → build →
// pull), the cache behaviour across calls, and the typed failure mapping.
//
// The six required scenarios from the phase spec:
//
//   it('defaults images per ecosystem')  it('overrides from config')
//   it('pulls when not cached')          it('builds local dockerfile')
//   it('caches across calls')            it('maps pull failure')

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ok, err } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../store/schema.js';
import type { BuildImageOptions } from './client.js';
import {
  ECOSYSTEM_IMAGES,
  EPHEMERAL_PREFIX,
  SANDBOX_IMAGES_TABLE_SQL,
  clearImageCacheForTests,
  ensureImage,
  ephemeralTagFor,
  imageFor,
  isEphemeralTag,
  type ImageClient,
} from './images.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeConfig {
  pullError?: StitchError;
  buildError?: StitchError;
  buildTag?: string;
}

function makeFakeClient(config: FakeConfig = {}): {
  client: ImageClient;
  calls: { pulls: string[]; builds: BuildImageOptions[] };
} {
  const calls = { pulls: [] as string[], builds: [] as BuildImageOptions[] };
  const client: ImageClient = {
    async pull(image: string) {
      calls.pulls.push(image);
      return config.pullError === undefined ? ok(undefined) : err(config.pullError);
    },
    async buildImage(options: BuildImageOptions) {
      calls.builds.push(options);
      if (config.buildError !== undefined) return err(config.buildError);
      return ok(config.buildTag ?? options.tag);
    },
  };
  return { client, calls };
}

/** In-memory DbLike (the P-145/P-160 test adapter pattern, local to this suite). */
function makeAdapter(path = ':memory:'): DbLike {
  const raw = new DatabaseSync(path);
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

let dockerfileDir: string;

beforeAll(async () => {
  dockerfileDir = await mkdtemp(join(tmpdir(), 'stitch-images-'));
  await writeFile(join(dockerfileDir, 'Dockerfile.node'), 'FROM node:22-alpine\n', 'utf8');
}, 30_000);

afterAll(async () => {
  await rm(dockerfileDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearImageCacheForTests();
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('P-169 sandbox images', () => {
  it('defaults images per ecosystem', () => {
    expect(imageFor('node')).toBe('oven/bun:1.1');
    expect(imageFor('python')).toBe('python:3.12-slim');
    expect(imageFor('rust')).toBe('rust:1.80-alpine');
    expect(imageFor('go')).toBe('golang:1.23-alpine');
    // Pinned to exact versions (phase handoff: reproducibility) and keyed by
    // the P-103 ecosystem union — no extra or missing entries.
    expect(Object.keys(ECOSYSTEM_IMAGES).sort()).toEqual(['go', 'node', 'python', 'rust']);
    for (const tag of Object.values(ECOSYSTEM_IMAGES)) expect(tag).toMatch(/:\d/);
  });

  it('overrides from config', async () => {
    const { client, calls } = makeFakeClient();
    const resolved = await ensureImage('node', client, {
      overrideImage: { node: 'acme/node:custom' },
    });
    expect(resolved.isOk() && resolved.value).toBe('acme/node:custom');
    // An override short-circuits both resolution paths.
    expect(calls.pulls).toHaveLength(0);
    expect(calls.builds).toHaveLength(0);

    // A blank override is ignored, not honoured.
    const blank = await ensureImage('go', client, { overrideImage: { go: '   ' } });
    expect(blank.isOk() && blank.value).toBe('golang:1.23-alpine');
    expect(calls.pulls).toEqual(['golang:1.23-alpine']);
  });

  it('pulls when not cached', async () => {
    const { client, calls } = makeFakeClient();
    const resolved = await ensureImage('python', client);
    expect(resolved.isOk() && resolved.value).toBe('python:3.12-slim');
    expect(calls.pulls).toEqual(['python:3.12-slim']);
    expect(calls.builds).toHaveLength(0);
  });

  it('builds local dockerfile', async () => {
    const { client, calls } = makeFakeClient();
    const resolved = await ensureImage('node', client, {
      buildLocal: true,
      dockerfileDir,
      platform: 'linux/amd64',
    });
    expect(resolved.isOk()).toBe(true);
    const ephemeral = ephemeralTagFor('node', 'oven/bun:1.1', 'linux/amd64');
    expect(resolved.isOk() && resolved.value).toBe(ephemeral);
    expect(isEphemeralTag(ephemeral)).toBe(true);
    expect(calls.pulls).toHaveLength(0);
    expect(calls.builds).toHaveLength(1);
    expect(calls.builds[0]?.dockerfile).toBe(`${dockerfileDir}/Dockerfile.node`);
    expect(calls.builds[0]?.tag).toBe(ephemeral);

    // A build failure surfaces as DOCKER_BUILD_FAILED.
    clearImageCacheForTests();
    const failing = makeFakeClient({
      buildError: { code: 'DOCKER_BUILD_FAILED', message: 'boom' },
    });
    const failed = await ensureImage('node', failing.client, {
      buildLocal: true,
      dockerfileDir,
    });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.code).toBe('DOCKER_BUILD_FAILED');
  });

  it('caches across calls', async () => {
    const { client, calls } = makeFakeClient();
    const db = makeAdapter();

    const first = await ensureImage('go', client, { db, platform: 'linux/amd64' });
    const second = await ensureImage('go', client, { db, platform: 'linux/amd64' });
    expect(first.isOk() && second.isOk()).toBe(true);
    // One pull for two calls (in-memory cache).
    expect(calls.pulls).toEqual(['golang:1.23-alpine']);

    // The row is persisted with the platform recorded.
    const rows = db
      .query('SELECT cache_key, ecosystem, tag, platform, image_id FROM sandbox_images')
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cache_key: 'go|golang:1.23-alpine|linux/amd64',
      ecosystem: 'go',
      tag: 'golang:1.23-alpine',
      platform: 'linux/amd64',
      image_id: 'golang:1.23-alpine',
    });

    // A cold in-memory cache still hits sqlite — no second pull.
    clearImageCacheForTests();
    const third = await ensureImage('go', client, { db, platform: 'linux/amd64' });
    expect(third.isOk() && third.value).toBe('golang:1.23-alpine');
    expect(calls.pulls).toEqual(['golang:1.23-alpine']);

    // A different platform is a different key, so it resolves again.
    const other = await ensureImage('go', client, { db, platform: 'linux/arm64' });
    expect(other.isOk()).toBe(true);
    expect(calls.pulls).toEqual(['golang:1.23-alpine', 'golang:1.23-alpine']);
  });

  it('maps pull failure', async () => {
    const { client } = makeFakeClient({
      pullError: { code: 'DOCKER_PULL_FAILED', image: 'rust:1.80-alpine', message: 'denied' },
    });
    const failed = await ensureImage('rust', client);
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) {
      expect(failed.error.code).toBe('DOCKER_PULL_FAILED');
      if (failed.error.code === 'DOCKER_PULL_FAILED')
        expect(failed.error.image).toBe('rust:1.80-alpine');
    }
  });

  it('rejects an unknown ecosystem', async () => {
    const { client, calls } = makeFakeClient();
    const bad = await ensureImage('ruby' as never, client);
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.code).toBe('CONFIG_ERROR');
    expect(calls.pulls).toHaveLength(0);
  });

  it('requires a dockerfileDir and an existing Dockerfile for buildLocal', async () => {
    const { client } = makeFakeClient();
    const noDir = await ensureImage('node', client, { buildLocal: true });
    expect(noDir.isErr()).toBe(true);
    if (noDir.isErr()) expect(noDir.error.code).toBe('CONFIG_ERROR');

    const missing = await ensureImage('rust', client, { buildLocal: true, dockerfileDir });
    expect(missing.isErr()).toBe(true);
    if (missing.isErr()) expect(missing.error.code).toBe('CONFIG_ERROR');
  });

  it('derives deterministic ephemeral tags', () => {
    const a = ephemeralTagFor('node', 'oven/bun:1.1', 'linux/amd64');
    expect(a).toBe(ephemeralTagFor('node', 'oven/bun:1.1', 'linux/amd64'));
    expect(a).toContain(EPHEMERAL_PREFIX);
    // Platform and ecosystem both participate.
    expect(a).not.toBe(ephemeralTagFor('node', 'oven/bun:1.1', 'linux/arm64'));
    expect(a).not.toBe(ephemeralTagFor('python', 'oven/bun:1.1', 'linux/amd64'));
    expect(isEphemeralTag('oven/bun:1.1')).toBe(false);
    expect(SANDBOX_IMAGES_TABLE_SQL).toContain('sandbox_images');
  });

  it('records a null platform for an unqualified pull', async () => {
    const { client } = makeFakeClient();
    const db = makeAdapter();
    await ensureImage('python', client, { db });
    const rows = db.query('SELECT cache_key, platform FROM sandbox_images').all();
    expect(rows[0]).toMatchObject({
      cache_key: 'python|python:3.12-slim|default',
      platform: null,
    });
  });
});

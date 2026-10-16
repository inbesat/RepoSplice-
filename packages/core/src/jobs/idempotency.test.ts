// P-250 — idempotency tests, against real SQLite and a real temp dir.
//
// The claim worth defending is that a HIT cannot be stale: the key encodes every
// declared input, so changing one must miss, and asking for a key that does not match
// the inputs you passed must return nothing rather than the stored row. The cache also
// refuses stages that are not provably pure, which is the other half of "never serve a
// stale result".
//
// The five required scenarios from the phase spec:
//
//   it('cache hit')  it('input change invalidates')  it('mixed stages')
//   it('enqueue dedupe')                            it('finalize no op')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChecksumManifest } from '../provenance/checksums.js';
import { makeDbAdapter } from '../sandbox/__tests__/fake-docker.js';
import { type DbLike } from '../store/schema.js';
import {
  cacheKey,
  evictLru,
  finalizeNoOp,
  findDuplicateJob,
  getCache,
  hasCache,
  isCacheable,
  jobSignature,
  putCache,
} from './idempotency.js';
import { PIPELINE_JOBS_TABLE_SQL } from './schema.js';

const T1 = '2026-10-17T00:00:00.000Z';
const T2 = '2026-10-17T00:01:00.000Z';
const CONFIG_HASH = 'cfg-abc';

let db: DbLike;
let dir: string;

beforeEach(async () => {
  db = makeDbAdapter();
  db.exec(PIPELINE_JOBS_TABLE_SQL);
  dir = await mkdtemp(join(tmpdir(), 'stitch-idem-'));
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('P-250 idempotency', () => {
  it('cache hit', () => {
    const inputs = { lockfile: 'sha-lock', manifests: 'sha-manifests' };
    const key = cacheKey({ stage: 'deps', configHash: CONFIG_HASH, inputs });

    // A miss before anything is stored.
    expect(hasCache(db, key)._unsafeUnwrap()).toBe(false);

    const put = putCache(db, {
      key,
      stage: 'deps',
      configHash: CONFIG_HASH,
      inputs,
      result: { merged: 3 },
    });
    expect(put.isOk()).toBe(true);

    expect(hasCache(db, key)._unsafeUnwrap()).toBe(true);
    const hit = getCache(db, key)._unsafeUnwrap();
    expect(hit?.result).toEqual({ merged: 3 });
    expect(hit?.stage).toBe('deps');
    expect(hit?.inputs).toEqual(inputs);

    // The key is order-insensitive over its inputs — two callers building the same
    // inputs differently must not miss each other.
    expect(
      cacheKey({
        stage: 'deps',
        configHash: CONFIG_HASH,
        inputs: { manifests: 'sha-manifests', lockfile: 'sha-lock' },
      })
    ).toBe(key);
    // ...but a config change is a different key.
    expect(cacheKey({ stage: 'deps', configHash: 'cfg-other', inputs })).not.toBe(key);

    // Reading touches last_access, which is what makes eviction LRU.
    const touched = getCache(db, key, inputs, { now: () => T2 })._unsafeUnwrap();
    expect(touched?.lastAccess).toBe(T2);
  });

  it('input change invalidates', () => {
    const inputs = { manifests: 'sha-v1' };
    const key = cacheKey({ stage: 'deps', configHash: CONFIG_HASH, inputs });
    putCache(db, { key, stage: 'deps', configHash: CONFIG_HASH, inputs, result: { merged: 1 } });

    // The same key with the same inputs reuses.
    expect(getCache(db, key, inputs)._unsafeUnwrap()?.result).toEqual({ merged: 1 });

    // A key asked for WITH DIFFERENT inputs returns nothing — serving it would be the
    // silent staleness this module exists to prevent.
    expect(getCache(db, key, { manifests: 'sha-v2' })._unsafeUnwrap()).toBeUndefined();

    // And changed inputs produce a different address, so the run re-executes.
    const changedKey = cacheKey({
      stage: 'deps',
      configHash: CONFIG_HASH,
      inputs: { manifests: 'sha-v2' },
    });
    expect(changedKey).not.toBe(key);
    expect(hasCache(db, changedKey)._unsafeUnwrap()).toBe(false);
  });

  it('mixed stages', () => {
    // Pure, verifiable stages are cacheable; AI generation and fs writes are not.
    expect(isCacheable('deps')).toBe(true);
    expect(isCacheable('licenses')).toBe(true);
    expect(isCacheable('provenance')).toBe(true);
    expect(isCacheable('sandbox')).toBe(true);
    expect(isCacheable('agent')).toBe(false);
    expect(isCacheable('finalize')).toBe(false);
    // A stage nobody has proved pure fails safe.
    expect(isCacheable('some-future-stage')).toBe(false);

    const refused = putCache(db, {
      key: 'k',
      stage: 'agent',
      configHash: CONFIG_HASH,
      inputs: {},
      result: { generated: true },
    });
    expect(refused.isErr()).toBe(true);
    if (refused.isErr()) expect(refused.error.code).toBe('CONFIG_ERROR');

    // A cacheable stage alongside it is stored normally.
    const okPut = putCache(db, {
      key: 'k2',
      stage: 'licenses',
      configHash: CONFIG_HASH,
      inputs: {},
      result: { verdict: 'allow' },
    });
    expect(okPut.isOk()).toBe(true);

    // LRU eviction keeps the most recent and reports what it dropped.
    putCache(db, { key: 'old', stage: 'deps', configHash: CONFIG_HASH, inputs: {}, result: {} });
    putCache(db, { key: 'new', stage: 'deps', configHash: CONFIG_HASH, inputs: {}, result: {} });
    getCache(db, 'new', undefined, { now: () => T2 });
    const evicted = evictLru(db, 1)._unsafeUnwrap();
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(hasCache(db, 'new')._unsafeUnwrap()).toBe(true);
  });

  it('enqueue dedupe', () => {
    const sig = { kind: 'stitch', configHash: CONFIG_HASH, sources: ['a#main', 'b#main'] };
    const signature = jobSignature(sig);

    const seed = (id: string, status: string, stored: string, createdAt = T1): void => {
      db.exec(
        `INSERT OR REPLACE INTO pipeline_jobs (id, kind, status, config_json, created_at)
         VALUES ('${id}', 'stitch', '${status}', '${JSON.stringify({ signature: stored })}', '${createdAt}')`
      );
    };

    seed('j1', 'queued', signature);

    // The same submission finds the in-flight job instead of starting a second merge.
    const dup = findDuplicateJob(db, sig, { now: () => T1 })._unsafeUnwrap();
    expect(dup).toEqual({ id: 'j1', duplicate: true });

    // Sources are order-insensitive.
    expect(
      findDuplicateJob(
        db,
        { ...sig, sources: ['b#main', 'a#main'] },
        { now: () => T1 }
      )._unsafeUnwrap()?.id
    ).toBe('j1');

    // A different config hash is a different job.
    expect(
      findDuplicateJob(db, { ...sig, configHash: 'cfg-other' }, { now: () => T1 })._unsafeUnwrap()
    ).toBeUndefined();

    // A FINISHED job is history, not an in-flight duplicate.
    seed('j2', 'succeeded', signature);
    db.exec("DELETE FROM pipeline_jobs WHERE id = 'j1'");
    expect(findDuplicateJob(db, sig, { now: () => T1 })._unsafeUnwrap()).toBeUndefined();

    // Outside the window the duplicate is not considered in flight.
    seed('j3', 'running', signature, T1);
    expect(
      findDuplicateJob(db, sig, { now: () => T2, windowMs: 1000 })._unsafeUnwrap()
    ).toBeUndefined();
  });

  it('finalize no op', async () => {
    await writeFile(join(dir, 'c.txt'), 'child content\n');
    const built = await buildChecksumManifest(dir, { now: () => T1 });
    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    const manifest = built.value;

    // Same checksums + empty diff = nothing to do.
    const already = await finalizeNoOp(dir, manifest, { isEmpty: true });
    expect(already._unsafeUnwrap()).toEqual({ unchanged: true, drifted: [] });

    // A pending diff still means work, even though the tree matches.
    const pending = await finalizeNoOp(dir, manifest, { isEmpty: false });
    expect(pending._unsafeUnwrap().unchanged).toBe(false);

    // A tampered tree is reported as drifted, and is never "unchanged" — an empty diff
    // must not be allowed to hide the tampering.
    await writeFile(join(dir, 'c.txt'), 'tampered\n');
    const drifted = await finalizeNoOp(dir, manifest, { isEmpty: true });
    const check = drifted._unsafeUnwrap();
    expect(check.unchanged).toBe(false);
    expect(check.drifted).toContain('c.txt');
  });
});

// P-173 — capture tests.
//
// Container access is a fake (`CaptureClient`) except in the one binding test,
// which drives the REAL `SandboxClient` over a minimal fake docker so the
// `onLog` wiring is exercised end-to-end rather than asserted by construction.
//
// The five required scenarios from the phase spec:
//
//   it('streams into bounded buffer')  it('caps at log limit')
//   it('extracts artifacts')           it('sanitizes artifact paths')
//   it('binds onLog to run')

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ok, err } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../store/schema.js';
import { SandboxClient, type ContainerLike, type DockerLike } from './client.js';
import {
  CAPTURE_RUNS_TABLE_SQL,
  CaptureManager,
  DEFAULT_LOG_CAPACITY,
  DEFAULT_MAX_ARTIFACT_BYTES,
  hostArtifactPath,
  sanitizeSegment,
  type CaptureClient,
} from './capture.js';

// ---------------------------------------------------------------------------
// Fakes + helpers
// ---------------------------------------------------------------------------

interface FakeConfig {
  stdout?: string[];
  stderr?: string[];
  follow?: string[];
  copyError?: StitchError;
}

function makeFakeCaptureClient(config: FakeConfig = {}): {
  client: CaptureClient;
  calls: { logs: string[]; follow: string[]; copies: { path: string; dir: string }[] };
} {
  const calls = {
    logs: [] as string[],
    follow: [] as string[],
    copies: [] as { path: string; dir: string }[],
  };
  const client: CaptureClient = {
    async logs(id: string) {
      calls.logs.push(id);
      return ok({ stdout: config.stdout ?? [], stderr: config.stderr ?? [] });
    },
    async followLogs(id: string) {
      calls.follow.push(id);
      return ok(Readable.from((config.follow ?? []).map(l => Buffer.from(l, 'utf8'))));
    },
    async copyFrom(_id: string, path: string, dir: string) {
      calls.copies.push({ path, dir });
      if (config.copyError !== undefined) return err(config.copyError);
      return ok(join(dir, `${basename(path)}.tar`));
    },
  };
  return { client, calls };
}

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

/** A minimal fake docker good enough for one real `SandboxClient.run`. */
function makeFakeDocker(lines: string[]): DockerLike {
  const container: ContainerLike = {
    start: async () => undefined,
    wait: async () => ({ StatusCode: 0 }),
    logs: async () => Buffer.from(lines.join('\n'), 'utf8'),
    remove: async () => undefined,
    stats: async () => ({}),
    inspect: async () => ({}),
    getArchive: async () => Readable.from([Buffer.from('tar')]),
    followLogs: async () => Readable.from([]) as unknown as NodeJS.ReadableStream,
  };
  return {
    ping: async () => 'OK',
    pull: async () => new EventEmitter(),
    buildImage: async () => new EventEmitter(),
    createContainer: async () => container,
    getContainer: () => container,
    getImage: () => ({ remove: async () => undefined }),
    getVolume: () => ({ remove: async () => undefined }),
    getNetwork: () => ({ remove: async () => undefined }),
    pruneImages: async () => ({}),
  };
}

let root: string;
let clock = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'stitch-capture-'));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  clock = 0;
});

const manager = (options: ConstructorParameters<typeof CaptureManager>[0] = {}): CaptureManager =>
  new CaptureManager({ now: () => `t${(clock += 1)}`, ...options });

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('P-173 capture', () => {
  it('streams into bounded buffer', async () => {
    const mgr = manager();
    const sink = mgr.bindRun('run-1');
    const { client } = makeFakeCaptureClient({ stdout: ['a', 'b'], stderr: ['c'] });

    const captured = await mgr.capture(client, 'run-1', 'container-1');
    expect(captured.isOk()).toBe(true);
    if (captured.isOk()) {
      expect(captured.value.runId).toBe('run-1');
      expect(captured.value.logs).toEqual(['a', 'b', 'c']);
      expect(captured.value.sizeBytes).toBe(Buffer.byteLength('a\nb\nc', 'utf8'));
      expect(captured.value.dropped).toBe(0);
    }
    // Every line carries an ISO-ish timestamp for re-run diffing, while the
    // spec's `string[]` shape stays available.
    const entries = mgr.entries('run-1');
    expect(entries).toHaveLength(3);
    expect(entries[0]?.ts).toBe('t1');
    expect(mgr.logs('run-1')).toEqual(['a', 'b', 'c']);

    // The sink itself appends (that is what `client.run`'s onLog feeds).
    sink.stream('d');
    expect(mgr.logs('run-1')).toEqual(['a', 'b', 'c', 'd']);

    // The json format reads the raw stream instead of the demuxed arrays.
    const raw = manager();
    const jsonClient = makeFakeCaptureClient({ follow: ['{"t":1}', '{"t":2}'] });
    const jsonCaptured = await raw.capture(jsonClient.client, 'run-2', 'c2', { format: 'json' });
    expect(jsonCaptured.isOk() && jsonCaptured.value.logs).toEqual(['{"t":1}', '{"t":2}']);
    expect(jsonClient.calls.follow).toEqual(['c2']);
  });

  it('caps at log limit', async () => {
    const mgr = manager({ logCapacity: 3 });
    const many = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const { client } = makeFakeCaptureClient({ stdout: many });

    const captured = await mgr.capture(client, 'run-cap', 'c1');
    // Overflow is reported as the typed limit error, and the LATEST lines stay.
    expect(captured.isErr()).toBe(true);
    if (captured.isErr() && captured.error.code === 'SANDBOX_LOG_LIMIT') {
      expect(captured.error.dropped).toBe(7);
      expect(captured.error.retained).toBe(3);
      expect(captured.error.runId).toBe('run-cap');
    }
    expect(mgr.logs('run-cap')).toEqual(['line 7', 'line 8', 'line 9']);
    expect(mgr.dropped('run-cap')).toBe(7);

    // Fits exactly → no error.
    const fits = manager({ logCapacity: 3 });
    const { client: c2 } = makeFakeCaptureClient({ stdout: ['x', 'y', 'z'] });
    const okCapture = await fits.capture(c2, 'run-fit', 'c2');
    expect(okCapture.isOk()).toBe(true);
    expect(DEFAULT_LOG_CAPACITY).toBeGreaterThan(100);
  });

  it('extracts artifacts', async () => {
    const hostDir = join(root, 'artifacts');
    const db = makeAdapter();
    const mgr = manager({ db });
    const { client, calls } = makeFakeCaptureClient();

    // The fake reports a path; pre-create the archives so the byte budget has
    // real sizes to read.
    await mkdir(join(hostDir, 'run-3'), { recursive: true });
    await writeFile(join(hostDir, 'run-3', 'dist.tar'), Buffer.alloc(2048));

    const extracted = await mgr.extractArtifacts(
      client,
      'run-3',
      'container-3',
      ['/workspace/dist', '/buildout/target'],
      hostDir
    );
    expect(extracted.isOk()).toBe(true);
    if (extracted.isOk()) {
      expect(extracted.value).toEqual([
        join(hostDir, 'run-3', 'dist.tar'),
        join(hostDir, 'run-3', 'target.tar'),
      ]);
    }
    // Each copy targeted the RUN-SCOPED dir.
    expect(calls.copies).toEqual([
      { path: '/workspace/dist', dir: join(hostDir, 'run-3') },
      { path: '/buildout/target', dir: join(hostDir, 'run-3') },
    ]);

    // Metadata is persisted for tracing (P-239/248).
    const record = mgr.getRun('run-3');
    expect(record.isOk() && record.value?.runId).toBe('run-3');
    if (record.isOk() && record.value !== null) {
      expect(record.value.artifacts).toHaveLength(2);
      expect(record.value.updatedAt).toBe('t1');
    }
    expect(CAPTURE_RUNS_TABLE_SQL).toContain('capture_runs');

    // The byte budget is enforced.
    await mkdir(join(hostDir, 'run-4'), { recursive: true });
    await writeFile(join(hostDir, 'run-4', 'dist.tar'), Buffer.alloc(2048));
    const tiny = manager({ maxArtifactBytes: 1024 });
    const over = await tiny.extractArtifacts(
      makeFakeCaptureClient().client,
      'run-4',
      'c4',
      ['/workspace/dist'],
      hostDir
    );
    expect(over.isErr()).toBe(true);
    if (over.isErr()) expect(over.error.code).toBe('SANDBOX_ARTIFACT_LIMIT');
    expect(DEFAULT_MAX_ARTIFACT_BYTES).toBe(100 * 1024 * 1024);

    // A copy failure propagates.
    const failing = manager();
    const boom = await failing.extractArtifacts(
      makeFakeCaptureClient({ copyError: { code: 'DOCKER_ERROR', message: 'gone' } }).client,
      'run-5',
      'c5',
      ['/workspace/dist'],
      hostDir
    );
    expect(boom.isErr()).toBe(true);
    if (boom.isErr()) expect(boom.error.code).toBe('DOCKER_ERROR');
  });

  it('sanitizes artifact paths', async () => {
    // Traversal attempts are refused for both segments.
    for (const bad of ['..', '../evil', 'a/b', 'C:evil', '.', '   ']) {
      expect(sanitizeSegment(bad).isErr(), `expected rejection for ${bad}`).toBe(true);
    }
    expect(sanitizeSegment('run-1')._unsafeUnwrap()).toBe('run-1');
    expect(hostArtifactPath('/host', 'run-1', 'dist')._unsafeUnwrap()).toBe('/host/run-1/dist');
    expect(hostArtifactPath('/host', '../escape', 'dist').isErr()).toBe(true);
    expect(hostArtifactPath('/host', 'run-1', '../escape').isErr()).toBe(true);

    // …and extractArtifacts refuses a traversing run id before copying.
    const mgr = manager();
    const { client, calls } = makeFakeCaptureClient();
    const bad = await mgr.extractArtifacts(client, '../escape', 'c1', ['/workspace/dist'], root);
    expect(bad.isErr()).toBe(true);
    if (bad.isErr()) expect(bad.error.code).toBe('CONFIG_ERROR');
    expect(calls.copies).toHaveLength(0);
  });

  it('binds onLog to run', async () => {
    const mgr = manager();
    const sink = mgr.bindRun('run-live');
    // The REAL client, over a fake docker: run() must feed the sink.
    const client = new SandboxClient({ docker: makeFakeDocker(['compiling', 'done']) });

    const ran = await client.run(
      { image: 'img:1', workingDir: '/workspace', cmd: ['echo'] },
      { timeoutMs: 5_000, onLog: line => sink.stream(line) }
    );
    expect(ran.isOk()).toBe(true);
    expect(mgr.logs('run-live')).toEqual(['compiling', 'done']);
    expect(mgr.entries('run-live')).toHaveLength(2);
  });
});

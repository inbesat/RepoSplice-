// P-251 — Orchestration: the acceptance suite.
//
// This is the GATE for the whole orchestration epic (P-238–P-250): it runs the real
// state machine, the real job queue, the real rollback/cancel/metrics/trace/cache
// modules and the real checksum writer TOGETHER, and asserts DB state + audit + files.
//
// Deliberately stubbed: the AI provider and the sandbox (the phase says so — "real
// providers are out of scope here"), because determinism is the point. Deliberately
// REAL: everything that is orchestration, plus `buildChecksumManifest` (which actually
// writes `checksums.sha256`), because a stub-written artifact would make the happy-path
// assertion a tautology. `credits.ts` / `sbom.ts` have their own unit tests; here they
// are stage outputs, which is what the orchestration gate is about.
//
// The seven required scenarios from the phase spec:
//
//   it('happy path')  it('resume crash')  it('cancel sandbox')  it('dry run')
//   it('rollback')    it('idempotent')    it('concurrency')

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type Result } from 'neverthrow';
import { defaultConfig } from '../../config/schema.js';
import { Pool } from '../../concurrency/pool.js';
import { resolveJobConfig, type JobConfig } from '../../jobs/jobConfig.js';
import { cancelJob, type CancelAuditSink } from '../../jobs/cancel.js';
import { cacheKey, getCache, isCacheable, putCache } from '../../jobs/idempotency.js';
import { MetricsCollector, finalizeMetrics, getMetrics } from '../../jobs/metrics.js';
import { JobQueue } from '../../jobs/queue.js';
import { rollbackJob, snapshotJob, type RollbackAuditSink } from '../../jobs/rollback.js';
import { PIPELINE_JOBS_TABLE_SQL } from '../../jobs/schema.js';
import { buildChecksumManifest } from '../../provenance/checksums.js';
import type { AuditDraft, AuditRecord } from '../../provenance/audit.js';
import type { StitchError } from '../../result/index.js';
import { makeDbAdapter } from '../../sandbox/__tests__/fake-docker.js';
import { type DbLike } from '../../store/schema.js';
import { Tracer, traceCollector } from '../../tracing/tracer.js';
import { buildDryRunPlan } from '../../pipeline/dryRun.js';
import { runPipeline } from '../../pipeline/runPipeline.js';
import type { StageHandler, StageOutcome } from '../../pipeline/stateMachine.js';

const T1 = '2026-10-17T00:00:00.000Z';

/** Let the event loop turn (real, short — the pool/stage waits are tiny). */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** An audit sink that records what it was asked to append. */
function auditSpy(): { sink: RollbackAuditSink & CancelAuditSink; drafts: AuditDraft[] } {
  const drafts: AuditDraft[] = [];
  const sink = {
    append: async (draft: AuditDraft): Promise<Result<AuditRecord, StitchError>> => {
      drafts.push(draft);
      return ok({ ...draft, id: `a${drafts.length}`, ts: T1 });
    },
  };
  return { sink, drafts };
}

let db: DbLike;
let work: string;
let outDir: string;

/** A resolved config for `jobId`, dry-run on or off. */
function cfgFor(jobId: string, dryRun = false): JobConfig {
  const resolved = resolveJobConfig({
    project: defaultConfig,
    jobId,
    flags: { outDir, ai: { provider: 'stub' }, flags: { dryRun } },
  });
  if (resolved.isErr()) throw new Error(`fixture config failed: ${resolved.error.code}`);
  return resolved.value;
}

/** The nine stage handlers a real run needs, with the AI/sandbox stubbed. */
function handlers(
  opts: {
    sandbox?: StageHandler;
    finalize?: StageHandler;
    onStage?: (stage: string) => void;
  } = {}
): Partial<Record<string, StageHandler>> {
  const pass =
    (stage: string, meta: Record<string, unknown> = {}): StageHandler =>
    async (ctx): Promise<StageOutcome> => {
      opts.onStage?.(stage);
      return { status: 'passed', meta: { ...meta, dryRun: ctx.dryRun } };
    };
  const finalize: StageHandler =
    opts.finalize ??
    (async (ctx): Promise<StageOutcome> => {
      // A real finalize must not write after a cancel arrived — that is what keeps a
      // cancelled job from leaving a partially-built C behind.
      if (ctx.signal?.aborted === true) {
        return { status: 'failed', error: 'aborted before finalize' };
      }
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'c.txt'), 'child content\n');
      await writeFile(join(outDir, 'CREDITS.md'), '# Credits\n');
      await writeFile(join(outDir, 'sbom.json'), '{"bomFormat":"CycloneDX"}\n');
      // The checksum manifest is written WITH C, by the stage that materialises it —
      // P-186's writer is the only one that touches the disk, and it belongs to the
      // moment C exists rather than to the preview stage before it.
      const built = await buildChecksumManifest(outDir, { repoC: outDir, now: () => T1 });
      if (built.isErr()) return { status: 'failed', error: built.error.code };
      return { status: 'passed', meta: { entries: built.value.entries.length } };
    });

  return {
    config: pass('config'),
    sources: pass('sources'),
    selection: pass('selection'),
    deps: pass('deps', { merged: 3 }),
    licenses: pass('licenses', { verdict: 'allow' }),
    agent: pass('agent', { proposedOps: [] }),
    sandbox: opts.sandbox ?? pass('sandbox', { verdict: 'pass' }),
    // PURE: it computes the anticipated manifest but writes NOTHING, so a dry run has
    // no side effects (the phase's own requirement).
    provenance: async (): Promise<StageOutcome> => {
      const built = await buildChecksumManifest(outDir, { now: () => T1 });
      if (built.isErr()) return { status: 'failed', error: built.error.code };
      return { status: 'passed', meta: { entries: built.value.entries.length } };
    },
    finalize,
  };
}

beforeEach(async () => {
  db = makeDbAdapter();
  db.exec(PIPELINE_JOBS_TABLE_SQL);
  work = await mkdtemp(join(tmpdir(), 'stitch-orch-'));
  outDir = join(work, 'child');
  await mkdir(outDir, { recursive: true });
});

afterEach(async () => {
  db.close();
  await rm(work, { recursive: true, force: true });
});

describe('P-251 orchestration', () => {
  it('happy path', async () => {
    const queue = new JobQueue({ db, now: () => T1 });
    const enqueued = await queue.enqueue({ id: 'j1', kind: 'stitch', ctx: {} });
    expect(enqueued.isOk()).toBe(true);
    await queue.claim('j1', 'w1');

    const run = await runPipeline({ cfg: cfgFor('j1'), handlers: handlers(), now: () => T1 });
    expect(run.isOk()).toBe(true);
    if (run.isErr()) return;
    expect(run.value.outcome).toBe('completed');

    const finalize = run.value.records.find(r => r.stage === 'finalize');
    expect(finalize?.status).toBe('passed');
    await queue.finish('j1', { commitTarget: outDir });
    expect((await queue.get('j1'))._unsafeUnwrap()?.status).toBe('succeeded');

    // The invariants: C plus the provenance artifacts actually exist on disk.
    expect(existsSync(join(outDir, 'c.txt'))).toBe(true);
    expect(existsSync(join(outDir, 'CREDITS.md'))).toBe(true);
    expect(existsSync(join(outDir, 'sbom.json'))).toBe(true);
    expect(existsSync(join(outDir, 'checksums.sha256'))).toBe(true);
    expect(await readFile(join(outDir, 'checksums.sha256'), 'utf8')).toContain('c.txt');
  });

  it('resume crash', async () => {
    // First attempt: the sandbox blows up. maxAttempts 1 leaves the stage failed.
    let attempts = 0;
    // A stage reports failure as a RESULT — the machine's contract is that a handler
    // never throws (a throwing handler would reject `run` itself).
    const crashing: StageHandler = async () => {
      attempts += 1;
      return { status: 'failed', error: 'sandbox died' };
    };
    const first = await runPipeline({
      cfg: cfgFor('j1'),
      handlers: handlers({ sandbox: crashing }),
      maxAttempts: 1,
      now: () => T1,
    });
    expect(first._unsafeUnwrap().outcome).toBe('failed');
    expect(attempts).toBe(1);
    // Nothing was finalised.
    expect(existsSync(join(outDir, 'c.txt'))).toBe(false);

    // Re-boot: resume from the persisted records, and the CACHE reuses the settled
    // stages instead of re-running them.
    // The cache predicate is the REAL one: only provably-pure stages may be reused.
    // A permissive stub would let `finalize` be skipped — and a skipped finalize is a
    // run that silently writes no C at all.
    const reused: string[] = [];
    const cache = {
      has: (stage: string): boolean => (
        reused.push(stage),
        stage !== 'sandbox' && isCacheable(stage)
      ),
    };
    const second = await runPipeline({
      cfg: cfgFor('j1'),
      handlers: handlers(),
      records: first._unsafeUnwrap().records,
      cache,
      maxAttempts: 1,
      now: () => T1,
    });
    const resumed = second._unsafeUnwrap();
    expect(resumed.outcome).toBe('completed');
    expect(reused.length).toBeGreaterThan(0); // the cache was consulted
    expect(resumed.records.find(r => r.stage === 'sandbox')?.status).toBe('passed');
    expect(existsSync(join(outDir, 'c.txt'))).toBe(true);
  });

  it('cancel sandbox', async () => {
    const queue = new JobQueue({ db, now: () => T1 });
    await queue.enqueue({ id: 'j1', kind: 'stitch', ctx: {} });
    await queue.claim('j1', 'w1');
    const { sink, drafts } = auditSpy();
    const controller = new AbortController();

    // A sandbox stage that takes long enough to be cancelled mid-flight.
    let sawAbort = false;
    const slowSandbox: StageHandler = async ctx => {
      await sleep(30);
      sawAbort = ctx.signal?.aborted === true;
      return { status: 'passed' };
    };

    const running = runPipeline({
      cfg: cfgFor('j1'),
      handlers: handlers({ sandbox: slowSandbox }),
      signal: controller.signal,
      maxAttempts: 1,
      now: () => T1,
    });
    await sleep(5);
    const cancelled = await cancelJob(queue, 'j1', {
      reason: 'user stopped it',
      controller,
      stagesCompleted: ['config', 'sources'],
      audit: sink,
    });
    expect(cancelled.isOk()).toBe(true);
    const result = await running;

    // Cooperative cancellation reached the stage...
    expect(sawAbort).toBe(true);
    // ...the job is cancelled, not failed...
    expect((await queue.get('j1'))._unsafeUnwrap()?.status).toBe('cancelled');
    // ...finalize refused to write, so there is no partial C...
    expect(existsSync(join(outDir, 'c.txt'))).toBe(false);
    // ...and the audit has the CancelRecord.
    expect(drafts.map(d => d.action)).toEqual(['cancel']);
    expect(result.isOk()).toBe(true);
  });

  it('dry run', async () => {
    const run = await runPipeline({
      cfg: cfgFor('j1', true),
      handlers: handlers(),
      now: () => T1,
    });
    const result = run._unsafeUnwrap();

    // The phase's contract: stages run to a verdict, finalize does not.
    expect(result.records.find(r => r.stage === 'finalize')?.status).toBe('skipped');
    expect(result.records.find(r => r.stage === 'finalize')?.meta.reason).toBe('dry-run');
    // NO side effects.
    expect(existsSync(join(outDir, 'c.txt'))).toBe(false);
    expect(existsSync(join(outDir, 'checksums.sha256'))).toBe(false);

    // And the preview is produced from the run.
    const plan = buildDryRunPlan(cfgFor('j1', true), result);
    expect(plan.jobId).toBe('j1');
    expect(plan.finalized).toBe(false);
    expect(plan.stages).toHaveLength(9);
  });

  it('rollback', async () => {
    // Snapshot BEFORE finalize, exactly as a real run would.
    await writeFile(join(outDir, 'preexisting.txt'), 'original\n');
    const snap = await snapshotJob(db, {
      jobId: 'j1',
      root: outDir,
      backupRoot: join(work, 'backups'),
      configPaths: ['preexisting.txt'],
      now: () => T1,
    });
    expect(snap.isOk()).toBe(true);

    const run = await runPipeline({ cfg: cfgFor('j1'), handlers: handlers(), now: () => T1 });
    expect(run._unsafeUnwrap().outcome).toBe('completed');
    await writeFile(join(outDir, 'preexisting.txt'), 'rewritten\n');

    const { sink, drafts } = auditSpy();
    const rolled = await rollbackJob(db, 'j1', {
      reason: 'CI caught a bad C',
      audit: sink,
      force: true,
    });
    expect(rolled.isOk()).toBe(true);
    if (rolled.isErr()) return;

    // Generated files removed, the pre-existing file restored, audit recorded.
    expect(existsSync(join(outDir, 'c.txt'))).toBe(false);
    expect(await readFile(join(outDir, 'preexisting.txt'), 'utf8')).toBe('original\n');
    expect(rolled.value.filesRemoved).toContain('c.txt');
    expect(drafts.map(d => d.action)).toEqual(['rollback']);
  });

  it('idempotent', async () => {
    // The stage cache reuses an unchanged result...
    const inputs = { manifests: 'sha-v1' };
    const key = cacheKey({ stage: 'deps', configHash: 'cfg-1', inputs });
    putCache(db, { key, stage: 'deps', configHash: 'cfg-1', inputs, result: { merged: 3 } });
    expect(getCache(db, key, inputs)._unsafeUnwrap()?.result).toEqual({ merged: 3 });

    // ...and the run reports the re-run with no diff as unchanged (P-250's finalize).
    const manifest = await buildChecksumManifest(outDir, { now: () => T1 });
    expect(manifest.isOk()).toBe(true);
    if (manifest.isErr()) return;
    const { finalizeNoOp } = await import('../../jobs/idempotency.js');
    const check = await finalizeNoOp(outDir, manifest.value, { isEmpty: true });
    expect(check._unsafeUnwrap().unchanged).toBe(true);

    // A second submission of the same job is a duplicate, not a second run.
    const { findDuplicateJob, jobSignature } = await import('../../jobs/idempotency.js');
    const sig = { kind: 'stitch', configHash: 'cfg-1', sources: ['a#main'] };
    db.exec(
      `INSERT OR REPLACE INTO pipeline_jobs (id, kind, status, config_json, created_at)
       VALUES ('j1', 'stitch', 'queued', '${JSON.stringify({ signature: jobSignature(sig) })}', '${T1}')`
    );
    expect(findDuplicateJob(db, sig, { now: () => T1 })._unsafeUnwrap()).toEqual({
      id: 'j1',
      duplicate: true,
    });
  });

  it('concurrency', async () => {
    // N jobs under a small budget, all completing without resource errors.
    const pool = new Pool({ limit: 2, name: 'sandbox' });
    const metrics = new MetricsCollector('job-c', { now: () => T1 });
    const tracer = new Tracer({
      now: () => T1,
      idFactory: (() => {
        let n = 0;
        return () => `s${++n}`;
      })(),
    });
    const traces = traceCollector();

    let inFlight = 0;
    let peak = 0;
    const runOne = async (n: number): Promise<Result<void, StitchError>> =>
      pool.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const root = tracer.startSpan(`job-${n}`, { kind: 'job' });
        const stage = tracer.withSpan(root, () => tracer.startSpan('sandbox', { kind: 'sandbox' }));
        metrics.tally('checks', 1);
        await sleep(5);
        stage.finish('ok');
        root.finish();
        traces.record('job-c', root.finish());
        inFlight -= 1;
      });

    const results = await Promise.all(Array.from({ length: 6 }, (_, n) => runOne(n)));
    expect(results.every(r => r.isOk())).toBe(true);
    // The budget held.
    expect(peak).toBeLessThanOrEqual(2);
    expect(pool.active).toBe(0);

    // Metrics and trace are non-empty and persist.
    metrics.recordResources({ cpuMs: 10, memMb: 64, jobs: 2 });
    const snapshot = metrics.snapshot();
    expect(snapshot.counts.checks).toBe(6);
    expect(snapshot.resources.sandboxJobs).toBe(2);
    expect(finalizeMetrics(db, snapshot, { now: () => T1 }).isOk()).toBe(true);
    expect(getMetrics(db, 'job-c')._unsafeUnwrap()?.counts.checks).toBe(6);

    const trace = traces.getTrace('job-c');
    expect(trace).toBeDefined();
    expect(trace?.spans.length).toBe(6);
  });
});

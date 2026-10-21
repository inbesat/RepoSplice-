// P-323 — the eval harness runner.
//
// One pair = clone A -> clone B -> extract A -> extract B -> agent -> sandbox.
// The runner ORCHESTRATES; it never duplicates the core modules: the steps
// are PORTS (the ADR-082 injection model) and the CLI wires the real
// implementations (git/clone, git/filterRepo). Production child creation
// is deferred with P-192; the CLI defaults reject that missing integration.
//
// Failure policy: a failing step is CAPTURED into the pair result (status
// 'failed' + the typed error code) and the run CONTINUES — one broken pair
// must not hide the other 19.
//
// Parallelism: the core Pool (P-031) bounds the concurrency; the observed
// maximum is reported in the summary so the bound is verifiable.

import type { AiCallAudit } from '../ai/audit.js';
import { summarizeCalls } from './cost.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err, type Result } from 'neverthrow';
import { Pool } from '../concurrency/pool.js';
import type { StitchError } from '../result/index.js';
import { evalPairSchema, type EvalPair } from './schema.js';
import { evalResultSchema, type EvalResult, type EvalRunSummary } from './types.js';

export interface EvalAgentContext {
  readonly pair: EvalPair;
  readonly workDir: string;
  readonly repoA: string;
  readonly repoB: string;
  readonly signal?: AbortSignal;
}

export interface EvalAgentOutcome {
  readonly tokens: number;
  readonly cost: number;
  /** P-330: the audited provider calls behind these numbers (P-145). */
  readonly audit?: readonly AiCallAudit[];
  readonly resolveRate?: number | null;
  readonly rubricScore?: number | null;
}

export interface EvalSandboxContext {
  readonly pair: EvalPair;
  readonly workDir: string;
  readonly repoA: string;
  readonly repoB: string;
  readonly signal?: AbortSignal;
}

export interface EvalSandboxOutcome {
  readonly buildPass: boolean | null;
  readonly resolveRate?: number | null;
  /** P-324: the sandbox logs + timings, when the port reports them. */
  readonly buildLogs?: readonly string[];
  readonly testLogs?: readonly string[];
  readonly buildDurationMs?: number;
  readonly testDurationMs?: number;
  readonly artifactsDir?: string;
}

/** The injected steps. Every one returns a Result — a port never throws. */
export interface EvalPorts {
  /** Implementations must checkout and verify sha before returning. Legacy two-argument fakes remain compatible. */
  readonly clone: (
    url: string,
    targetDir: string,
    options?: { readonly sha: string; readonly signal?: AbortSignal }
  ) => Promise<Result<string, StitchError>>;
  readonly extract: (
    repoPath: string,
    paths: readonly string[],
    signal?: AbortSignal
  ) => Promise<Result<string, StitchError>>;
  readonly agent: (context: EvalAgentContext) => Promise<Result<EvalAgentOutcome, StitchError>>;
  readonly sandbox: (
    context: EvalSandboxContext
  ) => Promise<Result<EvalSandboxOutcome, StitchError>>;
  readonly now: () => number;
  readonly mkdirp: (dir: string) => Promise<void>;
  readonly writeJson: (path: string, value: unknown) => Promise<void>;
}

export interface EvalRunnerOptions {
  readonly outputDir: string;
  readonly parallel?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Every StitchError carries a code; only some carry a message. */
function messageOf(error: StitchError): string {
  return 'message' in error && typeof error.message === 'string' ? error.message : error.code;
}

function isManifestPath(corpusPath: string): boolean {
  return corpusPath.toLowerCase().endsWith('.json');
}

export class EvalRunner {
  constructor(private readonly ports: EvalPorts) {}

  /** Read + validate the corpus manifest. */
  private async loadCorpus(corpusPath: string): Promise<Result<EvalPair[], StitchError>> {
    const file = isManifestPath(corpusPath) ? corpusPath : join(corpusPath, 'pairs.json');
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return err({
        code: 'FILE_NOT_FOUND',
        path: file,
        message: `corpus manifest not found: ${file}`,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({
        code: 'CONFIG_ERROR',
        field: 'corpus',
        message: `corpus manifest is not valid JSON: ${file}`,
      });
    }
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null
        ? (parsed as { pairs?: unknown }).pairs
        : undefined;
    if (!Array.isArray(list)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'corpus',
        message: 'corpus manifest must be an array of pairs',
      });
    }
    const pairs: EvalPair[] = [];
    for (const entry of list) {
      const outcome = evalPairSchema.safeParse(entry);
      if (!outcome.success) {
        const issue = outcome.error.issues[0];
        return err({
          code: 'CONFIG_ERROR',
          field: 'corpus',
          message: `invalid corpus entry${issue === undefined ? '' : ` at ${issue.path.join('.')}`}: ${issue?.message ?? 'schema mismatch'}`,
        });
      }
      pairs.push(outcome.data);
    }
    return ok(pairs);
  }

  private failure(pair: EvalPair, started: number, error: StitchError): EvalResult {
    return {
      pair_id: pair.pair_id,
      ecosystem: pair.ecosystem,
      status: 'failed',
      build_pass: null,
      build_logs: null,
      test_logs: null,
      rubric_score: null,
      resolve_rate: null,
      tokens_total: 0,
      cost_usd: 0,
      tokens: 0,
      cost: 0,
      duration: Math.max(0, this.ports.now() - started),
      error_code: error.code,
      error_message: messageOf(error),
    };
  }

  /** Run one pair; every step failure is captured, never thrown. */
  async runPair(pair: EvalPair, options: EvalRunnerOptions): Promise<EvalResult> {
    const started = this.ports.now();
    const workDir = join(options.outputDir, 'work', pair.pair_id);
    const cancelled = (): EvalResult =>
      this.failure(pair, started, {
        code: 'USER_CANCELLED',
        reason: `pair ${pair.pair_id} was cancelled`,
      });
    const signal = options.signal;
    const isCancelled = (): boolean => signal?.aborted === true;
    try {
      if (isCancelled()) return cancelled();
      await this.ports.mkdirp(workDir);
      if (isCancelled()) return cancelled();
      const repoA = await this.ports.clone(pair.repo_a_url, join(workDir, 'repo-a'), {
        sha: pair.repo_a_sha,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (isCancelled()) return cancelled();
      if (repoA.isErr()) return this.failure(pair, started, repoA.error);
      const repoB = await this.ports.clone(pair.repo_b_url, join(workDir, 'repo-b'), {
        sha: pair.repo_b_sha,
        ...(signal !== undefined ? { signal } : {}),
      });
      if (isCancelled()) return cancelled();
      if (repoB.isErr()) return this.failure(pair, started, repoB.error);
      const extractA = await this.ports.extract(repoA.value, pair.extract_paths_a, signal);
      if (isCancelled()) return cancelled();
      if (extractA.isErr()) return this.failure(pair, started, extractA.error);
      const extractB = await this.ports.extract(repoB.value, pair.extract_paths_b, signal);
      if (isCancelled()) return cancelled();
      if (extractB.isErr()) return this.failure(pair, started, extractB.error);
      const agent = await this.ports.agent({
        pair,
        workDir,
        repoA: repoA.value,
        repoB: repoB.value,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (isCancelled()) return cancelled();
      if (agent.isErr()) return this.failure(pair, started, agent.error);
      const sandbox = await this.ports.sandbox({
        pair,
        workDir,
        repoA: repoA.value,
        repoB: repoB.value,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (isCancelled()) return cancelled();
      if (sandbox.isErr()) return this.failure(pair, started, sandbox.error);
      const usage =
        agent.value.audit !== undefined && agent.value.audit.length > 0
          ? summarizeCalls(agent.value.audit)
          : undefined;
      return {
        pair_id: pair.pair_id,
        ecosystem: pair.ecosystem,
        status: 'succeeded',
        build_pass: sandbox.value.buildPass,
        build_logs: sandbox.value.buildLogs === undefined ? null : [...sandbox.value.buildLogs],
        test_logs: sandbox.value.testLogs === undefined ? null : [...sandbox.value.testLogs],
        rubric_score: agent.value.rubricScore ?? null,
        resolve_rate: sandbox.value.resolveRate ?? agent.value.resolveRate ?? null,
        tokens_total: usage?.tokensTotal ?? agent.value.tokens,
        cost_usd: usage?.costUsd ?? agent.value.cost,
        tokens: agent.value.tokens,
        cost: agent.value.cost,
        duration: Math.max(0, this.ports.now() - started),
        error_code: null,
        error_message: null,
      };
    } catch (error) {
      if (isCancelled()) return cancelled();
      return this.failure(pair, started, {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Abort at the budget, but keep the slot until the active port settles.
   * Cancellation is cooperative: an uncooperative port delays completion
   * indefinitely; releasing its slot early would violate the parallel bound.
   */
  private async runPairBounded(pair: EvalPair, options: EvalRunnerOptions): Promise<EvalResult> {
    const timeoutMs = options.timeoutMs;
    if (timeoutMs === undefined) return this.runPair(pair, options);
    const started = this.ports.now();
    const controller = new AbortController();
    let stopped: StitchError | undefined;
    const cancel = (): void => {
      if (controller.signal.aborted) return;
      stopped = { code: 'USER_CANCELLED', reason: `pair ${pair.pair_id} was cancelled` };
      controller.abort();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted === true) cancel();
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      stopped = {
        code: 'SANDBOX_TIMEOUT',
        timeoutMs,
        message: `pair ${pair.pair_id} exceeded its ${timeoutMs}ms budget`,
      };
      controller.abort();
    }, timeoutMs);
    try {
      const result = await this.runPair(pair, { ...options, signal: controller.signal });
      return stopped === undefined ? result : this.failure(pair, started, stopped);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  /** Run the whole corpus; the summary is written next to the per-pair files. */
  async run(
    corpusPath: string,
    options: EvalRunnerOptions
  ): Promise<Result<EvalRunSummary, StitchError>> {
    const loaded = await this.loadCorpus(corpusPath);
    if (loaded.isErr()) return err(loaded.error);
    const pairs = loaded.value;
    const parallel = Math.max(1, options.parallel ?? 1);
    const pool = new Pool({ limit: parallel, name: 'eval' });
    const results = new Array<EvalResult>(pairs.length);
    let active = 0;
    let maxConcurrency = 0;

    await Promise.all(
      pairs.map(async (pair, index) => {
        const acquired = await pool.acquire(options.signal);
        if (!acquired) {
          results[index] = this.failure(pair, this.ports.now(), {
            code: 'USER_CANCELLED',
            reason: `pair ${pair.pair_id} was cancelled before it started`,
          });
          return;
        }
        active += 1;
        maxConcurrency = Math.max(maxConcurrency, active);
        try {
          results[index] = await this.runPairBounded(pair, options);
        } finally {
          active -= 1;
          pool.release();
        }
      })
    );
    await pool.drain();

    await this.ports.mkdirp(options.outputDir);
    for (const result of results) {
      await this.ports.writeJson(join(options.outputDir, `${result.pair_id}.json`), result);
    }
    const summary: EvalRunSummary = {
      pairs: pairs.length,
      succeeded: results.filter(result => result.status === 'succeeded').length,
      failed: results.filter(result => result.status === 'failed').length,
      parallel,
      max_concurrency: maxConcurrency,
      results,
    };
    await this.ports.writeJson(join(options.outputDir, 'summary.json'), summary);
    return ok(summary);
  }
}

/** The result schema re-exported for the CLI + the emitted JSON Schema. */
export { evalResultSchema };

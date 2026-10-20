// P-323 — the eval harness runner.
//
// One pair = clone A -> clone B -> extract A -> extract B -> agent -> sandbox.
// The runner ORCHESTRATES; it never duplicates the core modules: the steps
// are PORTS (the ADR-082 injection model) and the CLI wires the real
// implementations (git/clone, git/filterRepo, pipeline/runPipeline,
// sandbox/runner).
//
// Failure policy: a failing step is CAPTURED into the pair result (status
// 'failed' + the typed error code) and the run CONTINUES — one broken pair
// must not hide the other 19.
//
// Parallelism: the core Pool (P-031) bounds the concurrency; the observed
// maximum is reported in the summary so the bound is verifiable.

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
}

/** The injected steps. Every one returns a Result — a port never throws. */
export interface EvalPorts {
  readonly clone: (url: string, targetDir: string) => Promise<Result<string, StitchError>>;
  readonly extract: (
    repoPath: string,
    paths: readonly string[]
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
      status: 'failed',
      build_pass: null,
      rubric_score: null,
      resolve_rate: null,
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
    try {
      await this.ports.mkdirp(workDir);
      const repoA = await this.ports.clone(pair.repo_a_url, join(workDir, 'repo-a'));
      if (repoA.isErr()) return this.failure(pair, started, repoA.error);
      const repoB = await this.ports.clone(pair.repo_b_url, join(workDir, 'repo-b'));
      if (repoB.isErr()) return this.failure(pair, started, repoB.error);
      const extractA = await this.ports.extract(repoA.value, pair.extract_paths_a);
      if (extractA.isErr()) return this.failure(pair, started, extractA.error);
      const extractB = await this.ports.extract(repoB.value, pair.extract_paths_b);
      if (extractB.isErr()) return this.failure(pair, started, extractB.error);
      const agent = await this.ports.agent({
        pair,
        workDir,
        repoA: repoA.value,
        repoB: repoB.value,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (agent.isErr()) return this.failure(pair, started, agent.error);
      const sandbox = await this.ports.sandbox({
        pair,
        workDir,
        repoA: repoA.value,
        repoB: repoB.value,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      if (sandbox.isErr()) return this.failure(pair, started, sandbox.error);
      return {
        pair_id: pair.pair_id,
        status: 'succeeded',
        build_pass: sandbox.value.buildPass,
        rubric_score: agent.value.rubricScore ?? null,
        resolve_rate: sandbox.value.resolveRate ?? agent.value.resolveRate ?? null,
        tokens: agent.value.tokens,
        cost: agent.value.cost,
        duration: Math.max(0, this.ports.now() - started),
        error_code: null,
        error_message: null,
      };
    } catch (error) {
      return this.failure(pair, started, {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Run one pair under the per-pair budget. */
  private async runPairBounded(pair: EvalPair, options: EvalRunnerOptions): Promise<EvalResult> {
    const timeoutMs = options.timeoutMs;
    if (timeoutMs === undefined) return this.runPair(pair, options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<EvalResult>(resolve => {
      timer = setTimeout(() => {
        resolve(
          this.failure(pair, this.ports.now(), {
            code: 'SANDBOX_TIMEOUT',
            timeoutMs,
            message: `pair ${pair.pair_id} exceeded its ${timeoutMs}ms budget`,
          })
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.runPair(pair, options), expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
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

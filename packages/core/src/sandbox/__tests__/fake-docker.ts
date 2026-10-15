// P-180 — the shared sandbox test harness.
//
// The Sandbox epic touches Docker, which is frequently unavailable (CI without a
// daemon, a developer's laptop, the P-167 agent E2E runs). Everything here is an
// in-process fake, so a suite can drive the FULL sequence — availability → image
// → install → build → test → capture → limits → fallback → verdict → cleanup →
// cache → secrets — with no daemon, no network, and no 60-second container start.
//
// Two design rules, both inherited from the production seams rather than chosen
// here:
//
//   1. THE FAKES IMPLEMENT THE SEAMS, NOT THE CLASS. `SandboxClient` has
//      `#private` fields and is therefore nominally typed (ADR-030), so no test
//      fake could be assigned to it. Every fake below implements the narrow
//      structural interface the production code declares — `DockerLike`,
//      `ContainerLike`, `SandboxTriggerClient`, `InstallClient` — which is why a
//      unit test needs no daemon at all.
//   2. NOTHING THROWS. A failed operation is SCRIPTED (`failStart`, `failWait`)
//      and surfaces as the client's own typed `Result`/`reject`, so a test can
//      assert `DOCKER_ERROR` / `SANDBOX_TIMEOUT` / `SANDBOX_ABORTED` mapping
//      rather than catching an exception from the harness.
//
// This harness is intended to be reused (P-167's agent E2E and the pipeline
// tests), so the surface is small and documented.

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../../result/index.js';
import {
  type DbLike,
  type SQLiteRow,
  type SQLiteValue,
  type StatementLike,
} from '../../store/schema.js';
import type {
  ContainerCreateOptionsLike,
  ContainerLike,
  ContainerRun,
  ContainerSpec,
  DockerLike,
  ImageBuildOptionsLike,
  RunOptions,
} from '../client.js';

/** In-memory `DbLike` (the P-145/P-160/P-169 test-adapter pattern). */
export function makeDbAdapter(): DbLike {
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

/** What the next container run should do. Re-settable between calls. */
export interface ContainerScript {
  /** Exit status the container reports. Default 0. */
  exitCode?: number;
  stdout?: string[];
  stderr?: string[];
  /** `start()` rejects (a docker-level failure). */
  failStart?: boolean;
  /** `wait()` rejects (a daemon failure mid-run). */
  failWait?: boolean;
  /** `wait()` never resolves until aborted (exercises timeouts). */
  hangUntilAborted?: boolean;
}

/** A `ContainerLike` plus the extra operations the phase's list names. */
export interface FakeContainer extends ContainerLike {
  /**
   * Recorded for completeness (P-180 step 1 lists `kill`).
   *
   * NOTE: `ContainerLike` — the production seam — deliberately has NO `kill`;
   * the client always force-REMOVES in a `finally` rather than killing and
   * leaving a corpse behind. The fake exposes the call so a test can assert
   * nothing depends on it, without inventing a method the real client does not
   * have.
   */
  kill(): Promise<void>;
}

/**
 * A scripted, in-process dockerode.
 *
 * Records every call (`calls`, `created`, `pulled`, `built`, `removed`) so a test
 * can assert what the client ACTUALLY asked the daemon to do — which is the whole
 * point of faking at the seam rather than at the class.
 */
export class FakeDockerode implements DockerLike {
  readonly calls: string[] = [];
  readonly created: ContainerCreateOptionsLike[] = [];
  readonly pulled: string[] = [];
  readonly built: string[] = [];
  readonly removed: string[] = [];
  readonly killed: string[] = [];
  readonly pruned: number[] = [];
  readonly archives = new Map<string, Buffer>();

  #script: ContainerScript;
  #pingFails: boolean;
  #pullFails = false;
  #buildFails = false;
  #container: FakeContainer;

  constructor(options: { script?: ContainerScript; pingFails?: boolean } = {}) {
    this.#script = options.script ?? {};
    this.#pingFails = options.pingFails === true;
    this.#container = this.#makeContainer('fake-container-1');
  }

  /** Replace the script for subsequent runs. */
  script(next: ContainerScript): void {
    this.#script = next;
  }

  /** Make the next `pull` reject. */
  failPull(): void {
    this.#pullFails = true;
  }

  /** Make the next `buildImage` reject. */
  failBuild(): void {
    this.#buildFails = true;
  }

  /** Make the next `ping` reject (drives the GitHub fallback selection). */
  failPing(fails = true): void {
    this.#pingFails = fails;
  }

  /** Preload bytes `getArchive` returns for a path (artifact copying). */
  setArchive(path: string, bytes: Buffer | string): void {
    this.archives.set(path, typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
  }

  #makeContainer(id: string): FakeContainer {
    const script = (): ContainerScript => this.#script;
    const container: FakeContainer = {
      id,
      kill: async () => {
        this.killed.push(id);
      },
      start: async () => {
        this.calls.push('start');
        if (script().failStart === true) throw new Error('scripted start failure');
        return undefined;
      },
      wait: async (options?: { abortSignal?: AbortSignal }) => {
        this.calls.push('wait');
        if (script().failWait === true) throw new Error('scripted wait failure');
        if (script().hangUntilAborted === true) {
          // Never resolves on its own; the client's own timeout/abort races it.
          await new Promise<never>((_resolve, reject) => {
            options?.abortSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          });
        }
        return { StatusCode: script().exitCode ?? 0 };
      },
      logs: async () => {
        this.calls.push('logs');
        // An unframed buffer: `demuxDockerLogs` treats it as all-stdout.
        const lines = [...(script().stdout ?? []), ...(script().stderr ?? [])];
        return Buffer.from(lines.join('\n'), 'utf8');
      },
      remove: async () => {
        this.calls.push('remove');
        this.removed.push(id);
        return undefined;
      },
      stats: async () => ({ cpu_stats: {}, memory_stats: {} }),
      inspect: async () => ({ Id: id, State: { Running: false } }),
      getArchive: async (options?: { path?: string }) => {
        this.calls.push('getArchive');
        const path = options?.path ?? '';
        return Readable.from(this.archives.get(path) ?? Buffer.from('', 'utf8'));
      },
      followLogs: async () => {
        this.calls.push('followLogs');
        const stream = new EventEmitter() as unknown as NodeJS.ReadableStream & EventEmitter;
        const lines = this.#script.stdout ?? [];
        // Emit on the next tick, then end — a stream that already ended is what
        // P-173's `#drainRaw` explicitly tolerates.
        process.nextTick(() => {
          if (lines.length > 0) stream.emit('data', Buffer.from(lines.join('\n'), 'utf8'));
          stream.emit('end');
        });
        return stream;
      },
    };
    return container;
  }

  async ping(): Promise<unknown> {
    this.calls.push('ping');
    if (this.#pingFails) throw new Error('Cannot connect to the Docker daemon');
    return 'OK';
  }

  async pull(repoTag: string): Promise<unknown> {
    this.calls.push(`pull:${repoTag}`);
    this.pulled.push(repoTag);
    if (this.#pullFails) {
      this.#pullFails = false;
      throw new Error('scripted pull failure');
    }
    return undefined;
  }

  async buildImage(
    _file: string | NodeJS.ReadableStream,
    options: ImageBuildOptionsLike
  ): Promise<unknown> {
    this.calls.push(`build:${options.t ?? ''}`);
    this.built.push(options.t ?? '');
    if (this.#buildFails) {
      this.#buildFails = false;
      throw new Error('scripted build failure');
    }
    return undefined;
  }

  async createContainer(options: ContainerCreateOptionsLike): Promise<ContainerLike> {
    this.calls.push('createContainer');
    this.created.push(options);
    return this.#container;
  }

  getContainer(): ContainerLike {
    return this.#container;
  }

  getImage(name: string): { remove(options?: { force?: boolean }): Promise<unknown> } {
    return {
      remove: async () => {
        this.calls.push(`image:remove:${name}`);
        return undefined;
      },
    };
  }

  getVolume(name: string): { remove(options?: { force?: boolean }): Promise<unknown> } {
    return {
      remove: async () => {
        this.calls.push(`volume:remove:${name}`);
        return undefined;
      },
    };
  }

  getNetwork(id: string): { remove(): Promise<unknown> } {
    return {
      remove: async () => {
        this.calls.push(`network:remove:${id}`);
        return undefined;
      },
    };
  }

  async pruneImages(): Promise<unknown> {
    this.calls.push('pruneImages');
    this.pruned.push(1);
    return { ImagesDeleted: [{ Deleted: 'sha256:deadbeef' }] };
  }
}

// ---------------------------------------------------------------------------
// GitHub Actions seam (P-100 `SandboxTriggerClient`, 4 methods)
// ---------------------------------------------------------------------------

/** One scripted workflow run, as P-095's correlator expects to find it. */
export interface FakeWorkflowRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
}

/**
 * The narrow Octokit fake (P-100's own seam declares only four methods).
 *
 * `runs: []` (the default) exercises the "dispatched but nothing to correlate"
 * path, which must NOT become a fabricated verdict.
 */
export class FakeOctokit {
  readonly dispatches: { workflow_id: string; ref: string; inputs?: Record<string, string> }[] = [];
  readonly repositoryDispatches: { event_type: string }[] = [];
  runs: FakeWorkflowRun[] = [];

  readonly rest = {
    repos: {
      createDispatchEvent: async (args: { event_type: string }) => {
        this.repositoryDispatches.push({ event_type: args.event_type });
        return { data: null, headers: {}, status: 204 };
      },
    },
    actions: {
      createWorkflowDispatch: async (args: {
        workflow_id: string;
        ref: string;
        inputs?: Record<string, string>;
      }) => {
        this.dispatches.push(args);
        return { data: null, headers: {}, status: 204 };
      },
      listWorkflowRunsForRepo: async () => ({
        data: { workflow_runs: this.runs },
        headers: {},
        status: 200,
      }),
      getWorkflowRun: async (args: { run_id: number }) => {
        const found = this.runs.find(run => run.id === args.run_id);
        return { data: found ?? {}, headers: {}, status: found === undefined ? 404 : 200 };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Small client fakes shared by the flow test
// ---------------------------------------------------------------------------

/** A scripted container client (P-170 `InstallClient`, P-171 `BuildClient`). */
export function makeRunClient(
  outcome: {
    exitCode?: number;
    stdout?: string[];
    stderr?: string[];
    error?: StitchError;
  } = {}
): {
  client: {
    run(spec: ContainerSpec, opts?: RunOptions): Promise<Result<ContainerRun, StitchError>>;
  };
  calls: { specs: ContainerSpec[]; options: (RunOptions | undefined)[] };
} {
  const calls = { specs: [] as ContainerSpec[], options: [] as (RunOptions | undefined)[] };
  return {
    calls,
    client: {
      run: async (spec: ContainerSpec, opts?: RunOptions) => {
        calls.specs.push(spec);
        calls.options.push(opts);
        if (outcome.error !== undefined) return err(outcome.error);
        return ok({
          exitCode: outcome.exitCode ?? 0,
          stdout: outcome.stdout ?? [],
          stderr: outcome.stderr ?? [],
          durationMs: 5,
        });
      },
    },
  };
}

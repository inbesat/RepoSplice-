// P-249 — Orchestration: the concurrency governor.
//
// Every unit of parallel work in a run — sandbox builds, AI calls, dep installs —
// goes through a `Pool`. Three properties are the point:
//
//   1. THE BUDGET IS SHARED, NOT PER-POOL. Named pools (one per stage, per the phase)
//      take their slot from a PARENT pool first, so sandbox + AI + dep-install compete
//      for ONE allowance. Without that, `--jobs 4` on three pools would put twelve
//      containers on a four-core host.
//   2. FAIRNESS IS EXPLICIT. FIFO within a priority level; a higher priority is served
//      first. That is what stops an HIL approval (P-160) queueing behind a
//      twenty-minute build it is supposed to unblock.
//   3. CANCELLATION IS PROMPT. A waiter observes its `AbortSignal` (P-246) while it is
//      QUEUED and leaves the queue immediately; a task that has not started never
//      starts. A task already RUNNING cannot be un-run — the signal is passed to it,
//      and the phase's stage-level checks are what actually stop the work.
//
// No-throw: `run` returns `Result<T, StitchError>`. A task that rejects is an
// `INTERNAL`; a task that exceeds its own deadline is also `INTERNAL`, carrying the
// deadline in the message; a task whose signal fired before it started is `ABORTED`.
// Nothing in this module throws.
//
// On the missing distinct code: a pool deadline is a genuinely different event from
// `USER_TIMEOUT` (P-156 `ask_user` — no human answered) and from `SANDBOX_TIMEOUT`
// (P-174 — a container blew its budget), so a dedicated `TASK_TIMEOUT` is the right
// long-term shape. ADR-066 records what that costs: the `ERROR_RULES` table in
// `agent/errors.ts` is a TOTAL record over the union, so a new code also means the
// classifier rules, the `errors.test.ts` recovery lists, and every exhaustive switch
// (e.g. `system/doctor.ts`). That is a coordinated multi-file change, so P-249 records
// it as follow-up debt rather than half-applying it — see ADR-072.

import { cpus } from 'node:os';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** A timer handle, opaque to callers. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** Options for {@link Pool}. */
export interface PoolOptions {
  /** Max tasks in flight in THIS pool. Clamped to >= 1. */
  limit: number;
  /** A pool whose budget must be taken before this one's (the global cap). */
  parent?: Pool;
  /** Label for diagnostics. */
  name?: string;
  /** Timer source; injectable so a test needs no real waiting. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

/** Options for {@link Pool.run}. */
export interface TaskOptions {
  /** Higher is served first among QUEUED tasks. Default 0. */
  priority?: number;
  /** Per-task deadline in ms. */
  timeoutMs?: number;
  /** Cancellation (P-246). Checked while queued and passed to the task. */
  signal?: AbortSignal;
}

/** One queued acquirer. */
interface Waiter {
  priority: number;
  /** Insertion order, so equal priorities are served FIFO. */
  seq: number;
  grant: (granted: boolean) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** A positive integer, or `undefined` when the value is absent or unusable. */
function positiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

/** Inputs for {@link resolveLimit}. */
export interface LimitsInput {
  /** `--jobs` / `--concurrency` (P-204). */
  configured?: number;
  /** This machine's cores. Defaults to `os.cpus().length`. */
  hostCpus?: number;
  /** P-176's sandbox host cap. */
  sandboxHostCap?: number;
}

/**
 * The effective concurrency: `min(configured, host cpu, sandbox host cap)`.
 *
 * An absent input does not constrain (it falls back to the host's core count), and the
 * result is never below 1 — a pool that can run nothing is a deadlock, not a limit.
 */
export function resolveLimit(input: LimitsInput = {}): number {
  const host = positiveInt(input.hostCpus) ?? Math.max(1, cpus().length);
  const configured = positiveInt(input.configured) ?? host;
  const sandboxCap = positiveInt(input.sandboxHostCap) ?? host;
  return Math.max(1, Math.min(configured, host, sandboxCap));
}

/**
 * The shared budget (P-249 step 2).
 *
 * One `Limits` per process; every stage pool takes a slot from it, so no combination
 * of configured per-stage pools can exceed host capacity.
 */
export class Limits {
  readonly #limit: number;
  readonly #global: Pool;

  constructor(input: LimitsInput = {}, timers: Pick<PoolOptions, 'setTimer' | 'clearTimer'> = {}) {
    this.#limit = resolveLimit(input);
    this.#global = new Pool({ limit: this.#limit, name: 'global', ...timers });
  }

  /** The resolved global budget. */
  get limit(): number {
    return this.#limit;
  }

  /** The shared pool every named pool defers to. */
  get global(): Pool {
    return this.#global;
  }

  /** A named stage pool drawing from the shared budget. */
  pool(name: string): Pool {
    return new Pool({ limit: this.#limit, parent: this.#global, name });
  }
}

/**
 * A semaphore with a bounded number of slots.
 *
 * `run` is the intended entry point; `acquire`/`release`/`tryAcquire` exist for a
 * caller that needs to hold a slot across several steps (the phase's preflight).
 */
export class Pool {
  readonly #limit: number;
  readonly #parent: Pool | undefined;
  readonly #name: string;
  readonly #setTimer: (fn: () => void, ms: number) => TimerHandle;
  readonly #clearTimer: (handle: TimerHandle) => void;
  readonly #queue: Waiter[] = [];
  #active = 0;
  #seq = 0;

  constructor(opts: PoolOptions) {
    this.#limit = Math.max(1, positiveInt(opts.limit) ?? 1);
    this.#parent = opts.parent;
    this.#name = opts.name ?? 'pool';
    this.#setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = opts.clearTimer ?? (handle => clearTimeout(handle));
  }

  /** This pool's own limit (not the shared one). */
  get limit(): number {
    return this.#limit;
  }

  /** Tasks currently holding a slot here. */
  get active(): number {
    return this.#active;
  }

  /** Tasks waiting for a slot here. */
  get queued(): number {
    return this.#queue.length;
  }

  /** The pool's label, for a trace or a log line. */
  get name(): string {
    return this.#name;
  }

  /**
   * Take a slot, waiting if necessary.
   *
   * Resolves `false` when the signal fired while waiting — the caller then reports
   * `ABORTED` rather than starting work nobody wants.
   */
  async acquire(signal?: AbortSignal, priority = 0): Promise<boolean> {
    if (signal?.aborted === true) return false;

    // Parent first: the shared budget is the outer gate.
    if (this.#parent !== undefined) {
      const granted = await this.#parent.acquire(signal);
      if (!granted) return false;
    }

    if (this.#active < this.#limit) {
      this.#active += 1;
      return true;
    }

    const granted = await new Promise<boolean>(resolve => {
      const waiter: Waiter = {
        priority,
        seq: (this.#seq += 1),
        grant: resolve,
        ...(signal !== undefined ? { signal } : {}),
      };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          // Leave the queue NOW rather than when the slot frees up.
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          resolve(false);
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.#queue.push(waiter);
    });

    if (!granted && this.#parent !== undefined) this.#parent.release();
    return granted;
  }

  /** Take a slot only if one is free right now. Never waits. */
  tryAcquire(): boolean {
    if (this.#active >= this.#limit) return false;
    if (this.#parent !== undefined && !this.#parent.tryAcquire()) return false;
    this.#active += 1;
    return true;
  }

  /** Give a slot back and hand it to the next waiter. */
  release(): void {
    if (this.#active > 0) this.#active -= 1;
    this.#dispatch();
    this.#parent?.release();
  }

  /** Hand free slots to the highest-priority waiters, FIFO within a level. */
  #dispatch(): void {
    while (this.#active < this.#limit && this.#queue.length > 0) {
      let bestIndex = 0;
      for (let i = 1; i < this.#queue.length; i++) {
        const candidate = this.#queue[i];
        const best = this.#queue[bestIndex];
        if (candidate === undefined || best === undefined) continue;
        if (
          candidate.priority > best.priority ||
          (candidate.priority === best.priority && candidate.seq < best.seq)
        ) {
          bestIndex = i;
        }
      }
      const [next] = this.#queue.splice(bestIndex, 1);
      if (next === undefined) return;
      if (next.onAbort !== undefined && next.signal !== undefined) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      this.#active += 1;
      next.grant(true);
    }
  }

  /**
   * Run one task under this pool's budget.
   *
   * The slot is released in a `finally`, so a rejecting task cannot leak capacity.
   */
  async run<T>(
    task: (signal: AbortSignal | undefined) => Promise<T> | T,
    opts: TaskOptions = {}
  ): Promise<Result<T, StitchError>> {
    // Priority is taken into account by the waiter, so it has to be set before
    // acquiring — hence a dedicated path rather than a plain `acquire`.
    const granted = await this.#acquireWithPriority(opts);
    if (!granted) {
      return err({
        code: 'ABORTED',
        message: `pool ${this.#name}: task cancelled before it started`,
      });
    }
    try {
      const work = Promise.resolve(task(opts.signal));
      if (opts.timeoutMs === undefined) {
        return ok(await work);
      }
      const ms = opts.timeoutMs;
      // A timed-out task cannot be un-run (a promise is not cancellable); the signal
      // is what actually stops it. The deadline RESOLVES a typed error rather than
      // rejecting, so nothing in this module throws. `INTERNAL` carries the deadline
      // in its message — the distinct code is recorded as follow-up debt above.
      let handle: TimerHandle | undefined;
      const timeout = new Promise<Result<T, StitchError>>(resolve => {
        handle = this.#setTimer(
          () =>
            resolve(
              err({
                code: 'INTERNAL',
                message: `pool ${this.#name}: task exceeded its ${ms}ms deadline`,
              })
            ),
          ms
        );
      });
      try {
        return await Promise.race<Result<T, StitchError>>([work.then(value => ok(value)), timeout]);
      } finally {
        if (handle !== undefined) this.#clearTimer(handle);
      }
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `pool ${this.#name}: task failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    } finally {
      this.release();
    }
  }

  /** Acquire a slot honouring a waiter's priority. */
  #acquireWithPriority(opts: TaskOptions): Promise<boolean> {
    return this.acquire(opts.signal, opts.priority);
  }

  /**
   * Wait until nothing is running here and nothing is queued.
   *
   * Used by a graceful shutdown (P-246) so a cancel waits for in-flight work rather
   * than abandoning it.
   */
  async drain(): Promise<void> {
    while (this.#active > 0 || this.#queue.length > 0) {
      await new Promise<void>(resolve => {
        this.#setTimer(resolve, 0);
      });
    }
  }
}

/** The `ABORTED` outcome is built inline above; a deadline is an `INTERNAL`. */

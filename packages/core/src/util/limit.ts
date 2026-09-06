// Bounded-concurrency helpers over `p-limit` (P-031).
//
// Parallel clones (P-069/P-086), concurrent sandbox runs (P-168-P-180),
// and rate-limited AI calls (P-139) must cap in-flight work to stay
// within sandbox/rate budgets (P-174/P-249). `p-limit` is the throttle;
// this module is the typed `Result` surface over it:
//
// - `createLimiter(concurrency)` → a `Limiter` with live `activeCount` /
//   `pendingCount` introspection (for the P-138 retry/backoff layer).
// - `withLimit(concurrency, fn)` → run `fn(run)` where `run` executes
//   one task under the cap, mapping throws to err.
// - `mapLimit(items, concurrency, mapper)` → bounded parallel map that
//   NEVER rejects wholesale: each item resolves to its own `Result`,
//   in input order, so one bad repo cannot kill a batch.
//
// Misuse (non-integer or < 1 concurrency) returns err(CONFIG_ERROR) —
// `p-limit` itself throws TypeError there, and we convert it at the
// boundary per the P-011 contract.

import pLimit, { type LimitFunction } from 'p-limit';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';

/** Task accepted by a `Limiter`: a thunk returning a value or promise. */
export type LimitedTask<T> = () => Promise<T> | T;

/**
 * A bounded runner. `run` executes one task under the cap; `map` runs
 * a batch; `activeCount`/`pendingCount` are live gauges from the
 * underlying `p-limit` queue.
 */
export interface Limiter {
  /** Maximum in-flight tasks (as validated at creation). */
  readonly concurrency: number;
  /** Currently executing task count (live). */
  readonly activeCount: number;
  /** Queued-but-waiting task count (live). */
  readonly pendingCount: number;
  /** Run one task under the cap; throws map to err(INTERNAL). */
  run<T>(task: LimitedTask<T>): Promise<Result<T, StitchError>>;
  /** Bounded parallel map; per-item Results, input order. */
  map<I, O>(
    items: readonly I[],
    mapper: (item: I, index: number) => Promise<O> | O
  ): Promise<Result<O, StitchError>[]>;
}

/** Validate the cap once, at the boundary. */
function checkConcurrency(concurrency: number): Result<number, StitchError> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'concurrency',
      message: `concurrency must be an integer >= 1, got ${concurrency}`,
    });
  }
  return ok(concurrency);
}

/** Map a task throw/rejection to a typed err with context. */
function taskError(cause: unknown, context: string): StitchError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { code: 'INTERNAL', message: `${context}: ${detail}` };
}

/**
 * Create a bounded runner. Returns err(CONFIG_ERROR) for misuse
 * (non-integer / < 1); `p-limit` would throw TypeError there.
 */
export function createLimiter(concurrency: number): Result<Limiter, StitchError> {
  const checked = checkConcurrency(concurrency);
  if (checked.isErr()) return err(checked.error);
  let limit: LimitFunction;
  try {
    limit = pLimit(checked.value);
  } catch (cause: unknown) {
    return err(taskError(cause, 'p-limit init failed'));
  }
  const run = async <T>(task: LimitedTask<T>): Promise<Result<T, StitchError>> => {
    try {
      return ok(await limit(task));
    } catch (cause: unknown) {
      return err(taskError(cause, 'limited task failed'));
    }
  };
  return ok({
    concurrency: checked.value,
    get activeCount() {
      return limit.activeCount;
    },
    get pendingCount() {
      return limit.pendingCount;
    },
    run,
    map: async <I, O>(
      items: readonly I[],
      mapper: (item: I, index: number) => Promise<O> | O
    ): Promise<Result<O, StitchError>[]> =>
      Promise.all(
        items.map((item, index) =>
          limit(() => mapper(item, index)).then(
            value => ok<O, StitchError>(value),
            (cause: unknown) =>
              err<O, StitchError>(taskError(cause, `mapLimit item ${index} failed`))
          )
        )
      ),
  });
}

/**
 * One-shot scoped execution: build a limiter, run `fn(run)`, drop it.
 * Returns err(CONFIG_ERROR) for a bad cap without invoking `fn`.
 */
export async function withLimit<T>(
  concurrency: number,
  fn: (run: <U>(task: LimitedTask<U>) => Promise<Result<U, StitchError>>) => Promise<T>
): Promise<Result<T, StitchError>> {
  const limiter = createLimiter(concurrency);
  if (limiter.isErr()) return err(limiter.error);
  try {
    return ok(await fn(limiter.value.run));
  } catch (cause: unknown) {
    return err(taskError(cause, 'withLimit body failed'));
  }
}

/**
 * Bounded parallel map over `items` with per-item `Result`s in input
 * order. A throwing mapper degrades that item to err — the batch never
 * rejects wholesale. Returns err(CONFIG_ERROR) only for a bad cap.
 */
export async function mapLimit<I, O>(
  items: readonly I[],
  concurrency: number,
  mapper: (item: I, index: number) => Promise<O> | O
): Promise<Result<Result<O, StitchError>[], StitchError>> {
  const limiter = createLimiter(concurrency);
  if (limiter.isErr()) return err(limiter.error);
  return ok(await limiter.value.map(items, mapper));
}

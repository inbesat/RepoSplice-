import { customAlphabet, nanoid } from 'nanoid';

// 21-char alphabet: same as nanoid's default but explicit; avoids the
// URL-unsafe characters (- and _) that some downstream string consumers
// (log aggregators, ANSI renderers) mishandle.
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateId = customAlphabet(alphabet, 12);

let sequence = 0;
let lastTimestamp = 0;

/**
 * Monotonic id builder for jobs and runs. Format: `prefix_<base36-ts>_<seq>_<rand>`.
 *
 * - `prefix` is a short tag (e.g. `job`, `run`, `step`).
 * - `base36-ts` is the wall-clock millisecond timestamp, sortable.
 * - `seq` is a within-millisecond counter that resets each tick — keeps
 *   ids unique when many are generated in the same millisecond (job queue
 *   bursts, parallel sub-tasks).
 * - `rand` is a 12-char nanoid for the cross-millisecond uniqueness tail.
 *
 * Example: `job_lj8k3q2m_3_aBcD1eF2gH3i`
 *
 * Safe under concurrency within a single Node/Bun process (the seq counter
 * is incremented synchronously). For cross-process safety, callers should
 * layer a process-id component on top of `prefix`.
 */
export function monotonicId(prefix: string): string {
  const ts = Date.now();
  if (ts === lastTimestamp) {
    sequence += 1;
  } else {
    lastTimestamp = ts;
    sequence = 0;
  }
  const tsPart = ts.toString(36);
  const seqPart = sequence.toString(36);
  const randPart = generateId();
  return `${prefix}_${tsPart}_${seqPart}_${randPart}`;
}

/**
 * Short, opaque random id (12 chars from a 62-char alphabet). Use for ids
 * that don't need to be sortable but must be globally unique within the
 * running process — config-secret keys, transient cache keys, etc.
 */
export function shortId(): string {
  return generateId();
}

/**
 * Long random id (21 chars, nanoid default). Use for human-shareable ids
 * (run URLs, share links) where collision resistance matters more than
 * compactness.
 */
export function longId(): string {
  return nanoid();
}

/** Reset internal counters. Exposed for tests only. */
export function _resetIdCountersForTests(): void {
  sequence = 0;
  lastTimestamp = 0;
}

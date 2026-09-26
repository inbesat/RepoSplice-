// P-160 — the HIL (human-in-the-loop) approval queue.
//
// P-157 made the policy decide that a tool needs a human. P-159 made the
// lifecycle enforce that nothing executes until the human answers. Neither one
// actually ASKS anybody: this phase is the thing that parks the request,
// presents it, and waits — durably, so an approval survives the process that
// asked for it.
//
// WHY SQLITE AND NOT A MAP. An approval gate outlives the request. The loop
// blocks; the human answers minutes later, possibly from a different process
// (the CLI TUI, P-198), possibly from the web (P-218), possibly after a crash.
// A `Map<id, ...>` in the loop's address space cannot survive any of that, so
// the pending set is a table and the in-memory waiter map is only a latency
// optimisation on top of it.
//
// THE DUPLICATE RULE IS ENFORCED BY THE DATABASE. "Overwrite a duplicate
// pending by toolName" is expressed as a PARTIAL UNIQUE INDEX
// (`UNIQUE(tool_name) WHERE status='pending'`) rather than a
// select-then-delete in application code. Two loops racing to gate the same tool
// would both pass an application-level check and leave two pending rows for one
// human to answer, and the second approval would then apply twice. The index
// makes that unrepresentable.
//
// NO POLLING. The spec offers "event emitter / polling with interval". Polling
// means a timer that has to be cleared on every exit path — resolve, reject,
// timeout, abort — and P-156 already showed how that goes wrong when one path
// is missed. `waitForResolution` uses a `Map<id, Deferred>` instead: no timer
// to leak, and the wake-up is a direct call. The timer here is only the timeout
// guard, and it is cleared in a `finally` on every path.
//
// A RESOLUTION THAT ARRIVED EARLY IS NOT LOST. `waitForResolution` consults the
// database before it waits, so a request the CLI approved while the loop was
// between states — or before a restart — returns immediately instead of hanging
// until the timeout. That is what makes the spec's "idempotent via id" real
// rather than aspirational.

import { ok, err, type Result } from 'neverthrow';
import { type DbLike, type SQLiteRow, type SQLiteValue } from '../store/schema.js';
import { type StitchError } from '../result/index.js';
import { logger } from '../logger/index.js';
import { isAgentState, type AgentState } from './state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What kind of human interaction this is (P-160 step 1). */
export type HilKind = 'component' | 'question' | 'permission';

/** Lifecycle of a parked request. */
export type HilStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** A parked request awaiting a human (P-160 step 1). */
export interface HilRequest {
  id: string;
  kind: HilKind;
  toolName: string;
  createdAt: string;
  /** Tool arguments, or whatever the UI needs to render the request. */
  payload: unknown;
  status: HilStatus;
  /** The lifecycle state the agent was in when it parked (P-159). */
  agentState?: AgentState;
}

/**
 * A human's answer (P-160 step 1).
 *
 * `by` is who answered; `note` is what they said. For `kind: 'question'` the
 * note IS the answer, which is why a question resolved without a note yields an
 * empty answer rather than a fabricated one. The shape is kept exactly as the
 * spec declares it rather than adding an `answer` field, because this type is
 * what P-198 and P-218 post against.
 */
export interface HilResolution {
  id: string;
  resolution: 'approved' | 'rejected';
  by: string;
  ts: string;
  note?: string;
}

/** Input to {@link HilQueue.enqueue} — the queue owns `status` and `id`. */
export interface HilEnqueue {
  kind: HilKind;
  toolName: string;
  payload: unknown;
  /** The lifecycle state to record. Optional; omitted when there is no machine. */
  agentState?: AgentState;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Append-only HIL tables, created on demand.
 *
 * Owned by this phase rather than added to `store/schema.ts`, because that
 * file's header reserves the store's schema extension for
 * P-181/187/230/239/241/303/309 and taking a slot another phase owns would
 * leave it with a migration to work around. This is the same arrangement
 * `ai/audit.ts` has used for `ai_calls` since P-145.
 */
export const HIL_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS hil_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  agent_state TEXT
);
CREATE TABLE IF NOT EXISTS hil_resolutions (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  resolution TEXT NOT NULL,
  by TEXT NOT NULL,
  ts TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_hil_requests_status ON hil_requests (status);
CREATE INDEX IF NOT EXISTS idx_hil_resolutions_request ON hil_resolutions (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hil_pending_tool
  ON hil_requests (tool_name) WHERE status = 'pending';
`.trim();

// ---------------------------------------------------------------------------
// Parsing helpers — a row read back is untrusted input
// ---------------------------------------------------------------------------

const HIL_KINDS: readonly HilKind[] = ['component', 'question', 'permission'];
const HIL_STATUSES: readonly HilStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

function str(value: SQLiteValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A corrupt payload must not take the queue down: an unreadable blob is
    // reported as `null` and the rest of the row is still usable.
    return null;
  }
}

function isKind(value: string): value is HilKind {
  return (HIL_KINDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is HilStatus {
  return (HIL_STATUSES as readonly string[]).includes(value);
}

/** Turn a row into a request, or `null` if the row is not a valid request. */
function rowToRequest(row: SQLiteRow): HilRequest | null {
  const kind = str(row['kind']);
  const status = str(row['status']);
  if (!isKind(kind) || !isStatus(status)) return null;
  const agentState = str(row['agent_state']);
  const base: HilRequest = {
    id: str(row['id']),
    kind,
    toolName: str(row['tool_name']),
    createdAt: str(row['created_at']),
    payload: parseJson(str(row['payload'], '{}')),
    status,
  };
  // An `agent_state` the machine no longer knows is dropped rather than
  // smuggled through as a string: the field's type is the state union, and a
  // value outside it is corruption, not data.
  return agentState.length > 0 && isAgentState(agentState) ? { ...base, agentState } : base;
}

function rowToResolution(row: SQLiteRow): HilResolution | null {
  const resolution = str(row['resolution']);
  if (resolution !== 'approved' && resolution !== 'rejected') return null;
  const note = str(row['note']);
  return {
    id: str(row['id']),
    resolution,
    by: str(row['by']),
    ts: str(row['ts']),
    ...(note.length > 0 ? { note } : {}),
  };
}

/** A parked promise, resolved by `resolve`/`cancel` or by the timeout guard. */
interface Deferred {
  settle: (outcome: Result<HilResolution, StitchError>) => void;
}

function newId(): string {
  // Deliberately dependency-free: the queue only needs uniqueness within one
  // database, and the caller's clock/entropy is injected in tests.
  return `hil_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** Construction options. */
export interface HilQueueOptions {
  /** The store. Tables are created on construction. */
  db: DbLike;
  /** Clock, injectable so tests do not depend on wall time. */
  now?: () => string;
  /** Id generator, injectable for deterministic ids in tests. */
  newId?: () => string;
  /** Fired when a resolution is recorded, for UI/WS subscribers. */
  onResolved?: (resolution: HilResolution, request: HilRequest) => void;
}

/** Options for {@link HilQueue.waitForResolution}. */
export interface HilWaitOptions {
  /** Bound on the wait. Omit to wait indefinitely. */
  timeoutMs?: number;
  /** Abort the wait. Equivalent to an active cancel by a human. */
  signal?: AbortSignal;
}

/**
 * The HIL approval queue (P-160).
 *
 * Durable and idempotent: a request can be answered from any process, at any
 * time, more than once, and the answer is the same every time.
 */
export class HilQueue {
  readonly #db: DbLike;
  readonly #now: () => string;
  readonly #newId: () => string;
  readonly #onResolved: ((r: HilResolution, q: HilRequest) => void) | undefined;
  /** Live waiters, keyed by request id. Latency optimisation only. */
  readonly #waiters = new Map<string, Deferred>();

  constructor(options: HilQueueOptions) {
    this.#db = options.db;
    this.#now = options.now ?? nowIso;
    this.#newId = options.newId ?? newId;
    this.#onResolved = options.onResolved;
    this.#db.exec(HIL_TABLES_SQL);
  }

  /**
   * Park a request for a human.
   *
   * If another request for the same `toolName` is still pending, it is
   * **replaced** — the database's partial unique index makes a second pending
   * row for one tool impossible, and the superseded request is marked
   * `cancelled` so it does not silently vanish from the audit trail. A
   * superseded waiter is woken with its own cancellation, so a loop blocked on
   * the old request learns it is no longer the live one.
   *
   * @param request - What is being gated
   * @returns The new request's id
   */
  enqueue(request: HilEnqueue): Result<string, StitchError> {
    const id = this.#newId();
    const createdAt = this.#now();

    const superseded = this.#supersedePending(request.toolName);
    if (superseded.isErr()) return err(superseded.error);
    // `.value` rather than iterating the Result: `Ok` and `Err` are both
    // array-like in neverthrow, so the union does not narrow for iteration.
    const supersededIds: string[] = superseded.value;

    try {
      this.#db
        .query(
          'INSERT INTO hil_requests ' +
            '(id, kind, tool_name, created_at, payload, status, agent_state) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          id,
          request.kind,
          request.toolName,
          createdAt,
          JSON.stringify(request.payload ?? null),
          'pending',
          request.agentState ?? null
        );
    } catch (e) {
      return err({
        code: 'INTERNAL',
        message: `Could not enqueue a ${request.kind} request: ${errorText(e)}`,
      });
    }

    // Wake anything blocked on the request we just superseded, so it stops
    // waiting for an answer that will now never come.
    for (const old of supersededIds) {
      this.#settleWaiter(
        old,
        err({
          code: 'ABORTED',
          message: `Superseded by a newer ${request.toolName} request (${id})`,
        })
      );
    }
    return ok(id);
  }

  /**
   * Every request still waiting on a human, oldest first.
   *
   * This is the data web P-218 and CLI P-198 render as pending gates.
   */
  pending(): Result<HilRequest[], StitchError> {
    try {
      const rows = this.#db
        .query(
          "SELECT * FROM hil_requests WHERE status = 'pending' ORDER BY created_at ASC, id ASC"
        )
        .all();
      return ok(collectRequests(rows));
    } catch (e) {
      return err({ code: 'INTERNAL', message: `Could not list pending: ${errorText(e)}` });
    }
  }

  /**
   * The spec's name for {@link pending}, kept because P-218 and P-198 are
   * written against it. Delegates rather than duplicating the query, so there
   * is one definition of "what is waiting".
   */
  listForUser(): Result<HilRequest[], StitchError> {
    return this.pending();
  }

  /** One request by id, or `null` if there is none. */
  get(id: string): Result<HilRequest | null, StitchError> {
    try {
      const row = this.#db.query('SELECT * FROM hil_requests WHERE id = ?').get(id);
      if (row === null) return ok(null);
      return ok(rowToRequest(row));
    } catch (e) {
      return err({ code: 'INTERNAL', message: `Could not read request ${id}: ${errorText(e)}` });
    }
  }

  /**
   * The recorded resolution for a request, or `null` if unanswered.
   *
   * This is what makes an approval that landed while nobody was waiting
   * recoverable, and what makes {@link resolve} idempotent.
   */
  resolutionFor(id: string): Result<HilResolution | null, StitchError> {
    try {
      const row = this.#db
        .query('SELECT * FROM hil_resolutions WHERE request_id = ? ORDER BY ts ASC, id ASC')
        .get(id);
      if (row === null) return ok(null);
      return ok(rowToResolution(row));
    } catch (e) {
      return err({
        code: 'INTERNAL',
        message: `Could not read resolution for ${id}: ${errorText(e)}`,
      });
    }
  }

  /**
   * Record a human's decision and wake anyone waiting on it.
   *
   * **Idempotent by request id**, which is the spec's step 5: a web approve
   * that is retried, double-clicked, or re-posted after a reconnect returns the
   * resolution already on record instead of applying the action twice. A request
   * that was already resolved returns that stored resolution whatever the new
   * verdict says — the first decision stands, because a human who approved and
   * then accidentally rejected the same card did not change their mind.
   *
   * @param id - The parked request
   * @param resolution - Who decided, and how
   * @returns The stored resolution
   */
  resolve(
    id: string,
    resolution: { resolution: 'approved' | 'rejected'; by: string; note?: string }
  ): Result<HilResolution, StitchError> {
    const existing = this.resolutionFor(id);
    if (existing.isErr()) return err(existing.error);
    if (existing.value !== null) {
      // Already answered. Re-wake a waiter (a retry can race the first wake)
      // but do not overwrite the decision. The stored row is the answer, so a
      // second `resolve` with a different verdict is reported, not applied.
      this.#settleWaiter(id, ok(existing.value));
      return ok(existing.value);
    }

    const request = this.get(id);
    if (request.isErr()) return err(request.error);
    if (request.value === null) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'id',
        message: `No pending HIL request with id ${id}`,
      });
    }

    const record: HilResolution = {
      id: this.#newId(),
      resolution: resolution.resolution,
      by: resolution.by,
      ts: this.#now(),
      ...(resolution.note !== undefined && resolution.note.length > 0
        ? { note: resolution.note }
        : {}),
    };

    try {
      this.#db
        .query(
          'INSERT INTO hil_resolutions (id, request_id, resolution, by, ts, note) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(record.id, id, record.resolution, record.by, record.ts, record.note ?? null);
      this.#db.query('UPDATE hil_requests SET status = ? WHERE id = ?').run(record.resolution, id);
    } catch (e) {
      return err({ code: 'INTERNAL', message: `Could not record resolution: ${errorText(e)}` });
    }

    this.#onResolved?.(record, request.value);
    this.#settleWaiter(id, ok(record));
    return ok(record);
  }

  /**
   * Cancel a pending request.
   *
   * Distinct from rejecting: a cancel says "this is no longer being asked"
   * (the job was aborted, the model changed its mind), which is a different
   * event from a human saying no. The waiter is woken with `ABORTED` so a
   * blocked loop stops waiting rather than timing out.
   */
  cancel(id: string, by: string, reason?: string): Result<void, StitchError> {
    const request = this.get(id);
    if (request.isErr()) return err(request.error);
    if (request.value === null) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'id',
        message: `No HIL request with id ${id}`,
      });
    }
    try {
      this.#db.query('UPDATE hil_requests SET status = ? WHERE id = ?').run('cancelled', id);
    } catch (e) {
      return err({ code: 'INTERNAL', message: `Could not cancel ${id}: ${errorText(e)}` });
    }
    // The cancellation is recorded in the message so the audit trail says who
    // stopped the wait and why; `by` is not stored in its own column because a
    // cancel is not a resolution and must never be mistaken for one.
    const note = reason !== undefined && reason.length > 0 ? ` (${reason})` : '';
    logger.info({ hilId: id, by }, `hil request cancelled${note}`);
    this.#settleWaiter(
      id,
      err({
        code: 'ABORTED',
        message:
          reason !== undefined && reason.length > 0
            ? `Request ${id} was cancelled: ${reason}`
            : `Request ${id} was cancelled by ${by}`,
      })
    );
    // A cancel is NOT a resolution, so `resolutionFor` stays null and a later
    // `waitForResolution` reports the request as gone rather than answered.
    return ok(undefined);
  }

  /**
   * Wait until a human answers, the request is cancelled, the wait times out,
   * or the signal aborts.
   *
   * Checks the database FIRST, so a decision that arrived while nobody was
   * waiting — a CLI approve between two loop states, or an approval that
   * survived a restart — returns immediately instead of hanging until the
   * timeout. That is what makes the spec's "idempotent via id" load-bearing.
   *
   * The timeout and the abort are kept distinct: `USER_TIMEOUT` means nobody
   * answered, `ABORTED` means someone actively stopped the wait. P-156
   * separated the same pair for the same reason — a loop that cannot tell
   * "declined" from "away" retries the wrong one.
   *
   * @param id - The parked request
   * @param options - Timeout bound and/or an abort signal
   */
  async waitForResolution(
    id: string,
    options: HilWaitOptions = {}
  ): Promise<Result<HilResolution, StitchError>> {
    const existing = this.resolutionFor(id);
    if (existing.isErr()) return err(existing.error);
    if (existing.value !== null) return ok(existing.value);

    // A cancelled request will never be answered; say so now rather than
    // waiting for a timeout that is guaranteed to expire.
    const request = this.get(id);
    if (request.isErr()) return err(request.error);
    if (request.value === null) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'id',
        message: `No HIL request with id ${id}`,
      });
    }
    if (request.value.status === 'cancelled') {
      return err({ code: 'ABORTED', message: `Request ${id} was cancelled` });
    }

    const { signal, timeoutMs } = options;
    if (signal?.aborted) {
      return err({ code: 'ABORTED', message: `Wait for ${id} aborted before it began` });
    }

    return new Promise<Result<HilResolution, StitchError>>(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: Result<HilResolution, StitchError>): void => {
        if (settled) return;
        settled = true;
        this.#waiters.delete(id);
        signal?.removeEventListener('abort', onAbort);
        if (timer !== undefined) clearTimeout(timer);
        resolve(outcome);
      };

      const onAbort = (): void => {
        finish(err({ code: 'ABORTED', message: `Wait for ${id} aborted` }));
      };

      this.#waiters.set(id, { settle: finish });

      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          finish(
            err({
              code: 'USER_TIMEOUT',
              message: `No human answered HIL request ${id}`,
              timeoutMs,
            })
          );
        }, timeoutMs);
      }
    });
  }

  /** How many loops are currently blocked on this queue. */
  get waitingCount(): number {
    return this.#waiters.size;
  }

  #settleWaiter(id: string, outcome: Result<HilResolution, StitchError>): void {
    const waiter = this.#waiters.get(id);
    if (waiter === undefined) return;
    // The waiter's own `finish` clears the map entry and the timer; removing it
    // here as well keeps the invariant true if `settle` is called re-entrantly.
    this.#waiters.delete(id);
    waiter.settle(outcome);
  }

  /**
   * Mark any still-pending request for `toolName` as cancelled, returning their
   * ids. Runs before the insert so the partial unique index is satisfied.
   *
   * Returns a `Result` rather than throwing: a read failure here is a store
   * problem the caller must be able to handle, and the only caller is
   * {@link enqueue}, which has an error channel.
   */
  #supersedePending(toolName: string): Result<string[], StitchError> {
    let rows: SQLiteRow[];
    try {
      rows = this.#db
        .query("SELECT id FROM hil_requests WHERE tool_name = ? AND status = 'pending'")
        .all(toolName);
    } catch (e) {
      return err({
        code: 'INTERNAL',
        message: `Could not read pending requests for ${toolName}: ${errorText(e)}`,
      });
    }
    const ids: string[] = [];
    for (const row of rows) {
      const id = str(row['id']);
      if (id.length === 0) continue;
      try {
        this.#db.query('UPDATE hil_requests SET status = ? WHERE id = ?').run('cancelled', id);
      } catch (e) {
        return err({
          code: 'INTERNAL',
          message: `Could not supersede request ${id}: ${errorText(e)}`,
        });
      }
      ids.push(id);
    }
    return ok(ids);
  }
}

/** Parse every valid row, skipping corrupt ones rather than failing the read. */
function collectRequests(rows: SQLiteRow[]): HilRequest[] {
  const out: HilRequest[] = [];
  for (const row of rows) {
    const parsed = rowToRequest(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** Never let an exception escape as a bare `Error` into a message. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

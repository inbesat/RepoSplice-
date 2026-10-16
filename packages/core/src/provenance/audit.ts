// P-187 — Provenance: the audit log.
//
// A complete, APPEND-ONLY record of what the stitch actually did: who did it, to
// what, when, and whether it worked. Trust and compliance both rest on being able
// to answer that after the fact, and on the answer not having been editable since.
//
// This is deliberately a SECOND audit surface. `store/schema.ts` already defines a
// general-purpose `audit` table (v1), and P-145 owns an AI-CALL audit
// (`ai_calls`); this one records PIPELINE events under its own `provenance_audit`
// table, so a compliance export can enumerate stitch actions without wading
// through provider traces or unrelated rows.
//
// Four properties are load-bearing:
//
//   1. APPEND-ONLY BY CONSTRUCTION, not by convention. The class exposes no
//      update and no delete. That is the whole guarantee, and it is verified by
//      asserting the ABSENCE of mutation rather than merely that `append` works.
//   2. DETAIL IS SANITIZED BEFORE STORE. Every string leaf is passed through
//      P-179's `scrubSecrets`, so a credential that reaches a log line cannot
//      reach the compliance dump. Sanitizing at INGRESS (before the row exists)
//      is the same choice P-173's capture made for a different stream.
//   3. A DURABLE STORE IS REQUIRED. There is no in-memory fallback: an audit that
//      evaporates with the process is not an audit, so a `DbLike` is mandatory.
//   4. THE DUMP IS ORDERED. `exportJson` sorts by `ts` then `id`, so two exports
//      of the same log are byte-identical and can be diffed (P-282).

import { err, ok, type Result } from 'neverthrow';
import { randomUUID } from 'node:crypto';
import { dbAll, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import { type StitchError } from '../result/index.js';
import { scrubSecrets } from '../sandbox/secrets.js';

/** Every action the pipeline can record. */
export type AuditAction =
  | 'init'
  | 'clone'
  | 'merge'
  | 'resolve_conflict'
  | 'install'
  | 'build'
  | 'test'
  | 'license_verdict'
  | 'sbom'
  | 'checksum'
  | 'git_notes'
  | 'commit'
  | 'push'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'rollback'
  | 'publish';

/** Every action, so a caller can validate rather than guess. */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'init',
  'clone',
  'merge',
  'resolve_conflict',
  'install',
  'build',
  'test',
  'license_verdict',
  'sbom',
  'checksum',
  'git_notes',
  'commit',
  'push',
  'approve',
  'reject',
  'cancel',
  'rollback',
  'publish',
];

/** One recorded action. */
export interface AuditRecord {
  id: string;
  /** ISO-8601, assigned on append. */
  ts: string;
  action: AuditAction;
  /** Who acted: a user id, `'agent'`, or a tool name. */
  actor: string;
  jobId?: string;
  detail: Record<string, unknown>;
  /** Whether the action succeeded. */
  ok: boolean;
}

/** What a caller supplies — `id` and `ts` are assigned by {@link ProvenanceAudit.append}. */
export type AuditDraft = Omit<AuditRecord, 'id' | 'ts'>;

/** Filters for {@link ProvenanceAudit.query}. */
export interface AuditQuery {
  action?: AuditAction;
  /** Inclusive lower bound on `ts`, compared as an ISO string. */
  since?: string;
  jobId?: string;
  actor?: string;
  /** Cap on returned rows. */
  limit?: number;
}

/** Options for {@link ProvenanceAudit}. */
export interface ProvenanceAuditOptions {
  /** Durable storage. REQUIRED — see the module header, point 3. */
  db: DbLike;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
}

/** The `provenance_audit` table (owned on first use, like P-145/P-169/P-173). */
export const PROVENANCE_AUDIT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS provenance_audit (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  job_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provenance_audit_ts ON provenance_audit (ts);
CREATE INDEX IF NOT EXISTS idx_provenance_audit_action ON provenance_audit (action);
CREATE INDEX IF NOT EXISTS idx_provenance_audit_job ON provenance_audit (job_id);`;

/** Is this a plain object worth descending into? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Scrub every string leaf of a detail object.
 *
 * Walking rather than stringifying keeps the shape intact: a caller reading the
 * record back sees the same structure it appended, minus the secret material.
 */
export function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return scrubSecrets(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key] = scrub(inner);
      return out;
    }
    return value;
  };
  const sanitized = scrub(detail);
  return isRecord(sanitized) ? sanitized : {};
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Parse a stored row back into an `AuditRecord`. */
function toRecord(row: SQLiteRow): AuditRecord | undefined {
  const id = row['id'];
  const ts = row['ts'];
  const action = row['action'];
  const actor = row['actor'];
  const detail = row['detail'];
  const ok = row['ok'];
  if (
    typeof id !== 'string' ||
    typeof ts !== 'string' ||
    typeof action !== 'string' ||
    typeof actor !== 'string' ||
    typeof detail !== 'string' ||
    typeof ok !== 'number'
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = {};
  }
  const jobId = row['job_id'];
  return {
    id,
    ts,
    action: action as AuditAction,
    actor,
    ...(typeof jobId === 'string' && jobId !== '' ? { jobId } : {}),
    detail: isRecord(parsed) ? parsed : {},
    ok: ok !== 0,
  };
}

/**
 * The append-only provenance audit log.
 *
 * Construct with a durable `DbLike`; the table and its indexes are created on
 * first use.
 */
export class ProvenanceAudit {
  readonly #db: DbLike;
  readonly #now: () => string;
  #ready = false;

  constructor(options: ProvenanceAuditOptions) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  #ensureTable(): Result<void, StitchError> {
    if (this.#ready) return ok(undefined);
    try {
      this.#db.exec(PROVENANCE_AUDIT_TABLE_SQL);
      this.#ready = true;
      return ok(undefined);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `provenance_audit table setup failed: ${detailOf(cause)}`,
      });
    }
  }

  /**
   * Record one action.
   *
   * `id` and `ts` are assigned here, and `detail` is sanitized BEFORE it is
   * written — a secret that reached this call never reaches a row.
   */
  async append(draft: AuditDraft): Promise<Result<AuditRecord, StitchError>> {
    if (draft.action.trim() === '' || draft.actor.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'action',
        message: 'ProvenanceAudit.append: action and actor are required',
      });
    }
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const record: AuditRecord = {
      id: randomUUID(),
      ts: this.#now(),
      action: draft.action,
      actor: draft.actor,
      ...(draft.jobId !== undefined && draft.jobId !== '' ? { jobId: draft.jobId } : {}),
      detail: sanitizeDetail(draft.detail),
      ok: draft.ok,
    };

    const written = dbRun(
      this.#db,
      `INSERT INTO provenance_audit (id, ts, action, actor, job_id, detail, ok)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.ts,
      record.action,
      record.actor,
      record.jobId ?? null,
      JSON.stringify(record.detail),
      record.ok ? 1 : 0
    );
    if (written.isErr()) return err(written.error);
    return ok(record);
  }

  /** Read records back, newest first, with optional filters. */
  async query(filter: AuditQuery = {}): Promise<Result<AuditRecord[], StitchError>> {
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.action !== undefined) {
      clauses.push('action = ?');
      params.push(filter.action);
    }
    if (filter.since !== undefined) {
      clauses.push('ts >= ?');
      params.push(filter.since);
    }
    if (filter.jobId !== undefined) {
      clauses.push('job_id = ?');
      params.push(filter.jobId);
    }
    if (filter.actor !== undefined) {
      clauses.push('actor = ?');
      params.push(filter.actor);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit =
      filter.limit !== undefined && Number.isFinite(filter.limit) && filter.limit > 0
        ? ` LIMIT ${Math.floor(filter.limit)}`
        : '';

    const rows = dbAll(
      this.#db,
      `SELECT id, ts, action, actor, job_id, detail, ok FROM provenance_audit${where} ORDER BY ts DESC, id DESC${limit}`,
      ...params
    );
    if (rows.isErr()) return err(rows.error);

    const records: AuditRecord[] = [];
    for (const row of rows.value) {
      const record = toRecord(row);
      if (record !== undefined) records.push(record);
    }
    return ok(records);
  }

  /** Every record, newest first. */
  async fullAudit(): Promise<Result<AuditRecord[], StitchError>> {
    return this.query();
  }

  /**
   * The whole log as a compliance-ready JSON dump.
   *
   * Ordered OLDEST first and by `id` within a timestamp, so two exports of the
   * same log are byte-identical and an auditor can diff them.
   */
  async exportJson(): Promise<Result<string, StitchError>> {
    const read = await this.query();
    if (read.isErr()) return err(read.error);
    const ordered = [...read.value].sort((a, b) =>
      a.ts === b.ts ? a.id.localeCompare(b.id) : a.ts.localeCompare(b.ts)
    );
    return ok(`${JSON.stringify(ordered, null, 2)}\n`);
  }
}

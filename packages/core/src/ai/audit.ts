// AI call audit log (P-145).
//
// Every provider call is auditable: provider/model, prompt version, context
// task, tokens, cost, latency, and outcome — for cost accounting (P-137/P-302),
// debugging (P-248), and compliance export (P-307).
//
// Storage is an append-only `ai_calls` table. Writes are buffered and flushed
// in a transaction every `flushEvery` calls so the hot loop never pays a write
// per call; `flush()`/`close()` drain the buffer, and `flushOnSignals()` wires
// the process-signal drain.
//
// Non-fatal by contract: a failing audit write is logged and swallowed so it
// can never break a stitch run. Anything dropped is counted in `droppedCount`.
//
// This module is `bun:sqlite`-FREE (it works against the structural `DbLike`),
// so the SQL stays exercisable under vitest's Node workers. Error payloads are
// scrubbed before they touch disk (SECURITY.md §1.1) — pino's redaction only
// protects log output, not a database column.

import { randomUUID } from 'node:crypto';
import {
  dbAll,
  dbGet,
  dbRun,
  type DbLike,
  type SQLiteRow,
  type SQLiteValue,
} from '../store/schema.js';
import { logger } from '../logger/index.js';
import { stitchErrorMessage } from '../result/index.js';
import type { FinishReason, ProviderError } from './types.js';

/** One audited provider call. */
export interface AiCallAudit {
  id: string;
  ts: string;
  provider: string;
  model: string;
  promptVersion: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  finishReason: FinishReason;
  error?: ProviderError;
  toolNames: string[];
  /**
   * Present when this row records a P-146 runtime provider switch rather than
   * a model call.
   */
  switch?: AiProviderSwitch;
  /**
   * Present when this row records a P-156 `ask_user` question/answer pair
   * rather than a model call.
   */
  question?: AiUserQuestion;
  /**
   * Present when this row records a P-157 autonomy-policy verdict rather than
   * a model call.
   */
  policy?: AiPolicyDecision;
  /**
   * Present when this row records a P-158 validation rejection rather than a
   * model call.
   */
  validation?: AiValidationFailure;
}

/** A tool args/result validation rejection (P-158). */
export interface AiValidationFailure {
  tool: string;
  /** `args` is checked before `execute`, `result` after it. */
  stage: 'args' | 'result';
  /** Which check failed, for filtering the audit trail. */
  kind: 'proto_pollution' | 'path_traversal' | 'depth_exceeded' | 'too_large' | 'invalid_json';
  /** The offending key path, for `proto_pollution` / `path_traversal` / `depth_exceeded`. */
  location?: string;
  /** Serialized payload size in bytes, for `too_large`. */
  size?: number;
  /** The limit that was exceeded. */
  max?: number;
  reason: string;
}

/** What {@link AiAuditLog.recordValidationFailure} needs to persist. */
export interface AiValidationFailureRecord extends AiValidationFailure {
  id?: string;
  ts?: string;
}

/** An autonomy-policy verdict (P-157), stored on the audit row. */
export interface AiPolicyDecision {
  tool: string;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  /** The mode the policy actually applied after overrides. */
  effectiveMode: string;
  /** The mode the tool itself declared. */
  requestedMode: string;
  /** True when the verdict came from the deny list rather than a mode. */
  denied: boolean;
}

/** What {@link AiAuditLog.recordPolicyDecision} needs to persist a verdict. */
export interface AiPolicyDecisionRecord extends AiPolicyDecision {
  id?: string;
  ts?: string;
}

/** A `ask_user` round-trip, stored on the audit row (P-156). */
export interface AiUserQuestion {
  questionId: string;
  prompt: string;
  /**
   * The answer as given. Redacted through `redactAuditText` before storage, so
   * a free-form answer carrying a credential shape never lands in a column.
   */
  answer: string;
  /** True when the human supplied free-form text rather than picking an option. */
  freeForm: boolean;
  /** `answered` | `cancelled` | `timeout` — the three terminal outcomes. */
  outcome: 'answered' | 'cancelled' | 'timeout';
}

/** What {@link AiAuditLog.recordUserQuestion} needs to persist an ask. */
export interface AiUserQuestionRecord extends AiUserQuestion {
  /** Model/provider labels for indexing; the ask itself calls no model. */
  provider?: string;
  model?: string;
  promptVersion?: string;
  id?: string;
  ts?: string;
}

/** A runtime provider switch (P-146), stored on the audit row. */
export interface AiProviderSwitch {
  reason: string;
  from: string;
  to: string;
}

/** What `AiAuditLog.recordSwitch` needs to persist a switch. */
export interface AiProviderSwitchRecord extends AiProviderSwitch {
  fromProvider: string;
  toProvider: string;
  fromModel: string;
  toModel: string;
  id?: string;
  ts?: string;
}

/** `task` value stamped on switch rows so they are queryable on their own. */
export const PROVIDER_SWITCH_TASK = 'provider-switch';

/** `task` value stamped on `ask_user` rows so they are queryable on their own. */
export const ASK_USER_TASK = 'ask-user';

/** `task` value stamped on autonomy-policy rows so they are queryable on their own. */
export const POLICY_TASK = 'autonomy-policy';

/** `task` value stamped on validation-rejection rows so they are queryable on their own. */
export const VALIDATION_TASK = 'tool-validation';

/** Filters for {@link AiAuditLog.query}. */
export interface AiCallQuery {
  task?: string;
  model?: string;
  /** ISO timestamp; only rows at/after it are returned. */
  since?: string;
  limit?: number;
}

export interface AiAuditLogOptions {
  /** Flush once this many calls are buffered. Default 10 (spec). */
  flushEvery?: number;
}

/** Default batch size (spec: `flushEvery=10`). */
export const DEFAULT_FLUSH_EVERY = 10;

/** Default row cap for {@link AiAuditLog.query} when no limit is given. */
export const DEFAULT_QUERY_LIMIT = 100;

/** Hard ceiling on a caller-supplied `limit`, so a bad input cannot page the DB. */
export const MAX_QUERY_LIMIT = 1000;

/**
 * Upper bound on buffered rows. If a flush keeps failing (locked file, disk
 * full) the buffer is dropped oldest-first past this cap rather than growing
 * without limit and taking the process down.
 */
const MAX_PENDING = 1000;

/**
 * Append-only `ai_calls` schema. Columns are only ever added, never renamed
 * (spec handoff) so historical rows stay readable.
 */
export const AI_CALLS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  finish_reason TEXT NOT NULL,
  error TEXT,
  tool_names TEXT NOT NULL DEFAULT '[]',
  switch_reason TEXT,
  question TEXT,
  policy TEXT,
  validation TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_task ON ai_calls (task);
CREATE INDEX IF NOT EXISTS idx_ai_calls_model ON ai_calls (model);
CREATE INDEX IF NOT EXISTS idx_ai_calls_ts ON ai_calls (ts);
`.trim();

/**
 * Additive migration for databases created before P-146 added
 * `switch_reason`. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a failure here
 * means the column already exists (or the table is fresh) — either way the
 * subsequent DDL is valid, so the error is not actionable.
 */
const AI_CALLS_ADD_SWITCH_REASON_SQL = 'ALTER TABLE ai_calls ADD COLUMN switch_reason TEXT';

/**
 * Additive migration for databases created before P-156 added `question`.
 * Same best-effort contract as `switch_reason`: a failure means the column
 * already exists, so the error is not actionable.
 */
const AI_CALLS_ADD_QUESTION_SQL = 'ALTER TABLE ai_calls ADD COLUMN question TEXT';

/**
 * Additive migration for databases created before P-157 added `policy`. Same
 * best-effort contract as the two columns above it.
 */
const AI_CALLS_ADD_POLICY_SQL = 'ALTER TABLE ai_calls ADD COLUMN policy TEXT';

/**
 * Additive migration for databases created before P-158 added `validation`.
 * Same best-effort contract as the three columns above it.
 */
const AI_CALLS_ADD_VALIDATION_SQL = 'ALTER TABLE ai_calls ADD COLUMN validation TEXT';

const INSERT_SQL =
  'INSERT INTO ai_calls ' +
  '(id, ts, provider, model, prompt_version, task, input_tokens, output_tokens, ' +
  'cost_usd, latency_ms, finish_reason, error, tool_names, switch_reason, question, policy, validation) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

/**
 * Secret shapes that must never reach a stored column. pino's `redact` covers
 * structured log output; this covers free-form provider error text.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // OpenAI/Anthropic-style keys and bearer tokens.
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  // `apiKey=...`, `"token": "..."`, `password: ...`
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)\b(\s*[:=]\s*)\S+/gi,
];

/**
 * Scrub credential-looking substrings out of text destined for storage.
 * Exported so callers (and tests) can assert the same guarantee.
 */
export function redactAuditText(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, match => {
      // Keep the `key:` / `key=` prefix so the shape of the message survives.
      const separator = match.match(/\s*[:=]\s*/);
      return separator ? `${match.slice(0, match.indexOf(separator[0]))}[REDACTED]` : '[REDACTED]';
    });
  }
  return out;
}

/** Redact a provider error before it is persisted or logged. */
export function redactProviderError(error: ProviderError): ProviderError {
  return { ...error, message: redactAuditText(error.message) };
}

/** Fresh audit id. */
export function newAuditId(): string {
  return randomUUID();
}

/** Current time as the ISO-8601 string stored in `ts`. */
export function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: SQLiteValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: SQLiteValue | undefined, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function rowToAudit(row: SQLiteRow): AiCallAudit {
  const finishReason = asString(row.finish_reason, 'error') as FinishReason;
  const errorRaw = asString(row.error, '');
  const toolNames = parseJson<string[]>(asString(row.tool_names, '[]'), []);
  const audit: AiCallAudit = {
    id: asString(row.id),
    ts: asString(row.ts),
    provider: asString(row.provider),
    model: asString(row.model),
    promptVersion: asString(row.prompt_version),
    task: asString(row.task),
    inputTokens: asNumber(row.input_tokens),
    outputTokens: asNumber(row.output_tokens),
    costUsd: asNumber(row.cost_usd),
    latencyMs: asNumber(row.latency_ms),
    finishReason,
    toolNames: Array.isArray(toolNames) ? toolNames.map(String) : [],
  };
  if (errorRaw.length > 0) {
    const parsed = parseJson<ProviderError | null>(errorRaw, null);
    if (parsed) audit.error = parsed;
  }
  const switchRaw = asString(row.switch_reason, '');
  if (switchRaw.length > 0) {
    const parsed = parseJson<AiProviderSwitch | null>(switchRaw, null);
    if (parsed) audit.switch = parsed;
  }
  const questionRaw = asString(row.question, '');
  if (questionRaw.length > 0) {
    const parsed = parseJson<AiUserQuestion | null>(questionRaw, null);
    if (parsed) audit.question = parsed;
  }
  const policyRaw = asString(row.policy, '');
  if (policyRaw.length > 0) {
    const parsed = parseJson<AiPolicyDecision | null>(policyRaw, null);
    if (parsed) audit.policy = parsed;
  }
  const validationRaw = asString(row.validation, '');
  if (validationRaw.length > 0) {
    const parsed = parseJson<AiValidationFailure | null>(validationRaw, null);
    if (parsed) audit.validation = parsed;
  }
  return audit;
}

/**
 * Append-only audit sink for AI provider calls.
 *
 * @example
 * ```ts
 * const opened = await openSqlite(':memory:');
 * if (opened.isErr()) return opened;
 * const audit = new AiAuditLog(opened.value);
 * audit.record(call);   // buffered; auto-flushes every 10 calls
 * const spent = await audit.costTotal();
 * ```
 */
export class AiAuditLog {
  readonly #db: DbLike;
  readonly #flushEvery: number;
  #pending: AiCallAudit[] = [];
  #dropped = 0;

  constructor(db: DbLike, options: AiAuditLogOptions = {}) {
    this.#db = db;
    this.#flushEvery = Math.max(1, Math.floor(options.flushEvery ?? DEFAULT_FLUSH_EVERY));
    this.#ensureSchema();
  }

  /** Calls dropped because the buffer overflowed after repeated flush failures. */
  get droppedCount(): number {
    return this.#dropped;
  }

  /** Number of calls currently buffered (not yet written). */
  get pendingCount(): number {
    return this.#pending.length;
  }

  #ensureSchema(): void {
    try {
      this.#db.exec(AI_CALLS_TABLE_SQL);
      // Best-effort additive migration for pre-P-146 databases.
      try {
        this.#db.exec(AI_CALLS_ADD_SWITCH_REASON_SQL);
      } catch {
        // Column already present, or table was just created with it.
      }
      // Best-effort additive migration for pre-P-156 databases.
      try {
        this.#db.exec(AI_CALLS_ADD_QUESTION_SQL);
      } catch {
        // Column already present, or table was just created with it.
      }
      // Best-effort additive migration for pre-P-157 databases.
      try {
        this.#db.exec(AI_CALLS_ADD_POLICY_SQL);
      } catch {
        // Column already present, or table was just created with it.
      }
      // Best-effort additive migration for pre-P-158 databases.
      try {
        this.#db.exec(AI_CALLS_ADD_VALIDATION_SQL);
      } catch {
        // Column already present, or table was just created with it.
      }
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      logger.error({ err: detail }, 'ai audit: failed to create ai_calls table');
    }
  }

  /**
   * Buffer one audited call, flushing when the batch is full.
   *
   * Never throws: the audit trail is diagnostic, and losing a row must not fail
   * the stitch run that produced it.
   *
   * @param call - The audit record to persist
   */
  record(call: AiCallAudit): void {
    this.#enqueue(call);
  }

  /**
   * Record a runtime provider switch (P-146) on the same append-only trail.
   *
   * Written as a zero-token row under {@link PROVIDER_SWITCH_TASK} so switch
   * history is queryable with the existing `query({ task })` filter and carries
   * no fabricated cost/latency.
   *
   * @param record - Reason plus from/to provider and model
   */
  recordSwitch(record: AiProviderSwitchRecord): void {
    this.#enqueue({
      id: record.id ?? newAuditId(),
      ts: record.ts ?? nowIso(),
      provider: record.toProvider,
      model: record.toModel,
      promptVersion: '',
      task: PROVIDER_SWITCH_TASK,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      finishReason: 'stop',
      toolNames: [],
      switch: { reason: record.reason, from: record.from, to: record.to },
    });
  }

  /**
   * Record an `ask_user` round-trip (P-156) on the same append-only trail.
   *
   * Written as a zero-token row under {@link ASK_USER_TASK}, mirroring
   * {@link recordSwitch}: an ask calls no model, so it carries no fabricated
   * cost or latency, and its history is queryable with the existing
   * `query({ task })` filter.
   *
   * The answer is redacted through `redactAuditText` before it reaches the
   * column, because a free-form answer is human text that can carry a
   * credential shape and this is a database, not a redacting log pipeline.
   *
   * @param record - The question, the answer, and how the exchange ended
   */
  recordUserQuestion(record: AiUserQuestionRecord): void {
    this.#enqueue({
      id: record.id ?? newAuditId(),
      ts: record.ts ?? nowIso(),
      provider: record.provider ?? 'human',
      model: record.model ?? 'n/a',
      promptVersion: record.promptVersion ?? '',
      task: ASK_USER_TASK,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      finishReason: 'stop',
      toolNames: ['ask_user'],
      question: {
        questionId: record.questionId,
        prompt: redactAuditText(record.prompt),
        answer: redactAuditText(record.answer),
        freeForm: record.freeForm,
        outcome: record.outcome,
      },
    });
  }

  /**
   * Record an autonomy-policy verdict (P-157) on the same append-only trail.
   *
   * Mirrors {@link recordUserQuestion} and {@link recordSwitch}: a policy
   * check calls no model, so the row carries no fabricated cost or latency, and
   * the history is queryable with `query({ task })`.
   *
   * The reason is redacted because it may quote a tool name or config value
   * that a caller supplied.
   *
   * @param record - The tool, the verdict, the modes involved, and the reason
   */
  recordPolicyDecision(record: AiPolicyDecisionRecord): void {
    this.#enqueue({
      id: record.id ?? newAuditId(),
      ts: record.ts ?? nowIso(),
      provider: 'policy',
      model: 'n/a',
      promptVersion: '',
      task: POLICY_TASK,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      finishReason: 'stop',
      toolNames: [record.tool],
      policy: {
        tool: record.tool,
        action: record.action,
        reason: redactAuditText(record.reason),
        effectiveMode: record.effectiveMode,
        requestedMode: record.requestedMode,
        denied: record.denied,
      },
    });
  }

  /**
   * Record a tool args/result validation rejection (P-158).
   *
   * Same shape as the other non-model rows: zero tokens, zero cost, zero
   * latency, and its own `task` so `query({ task: 'tool-validation' })` answers
   * "what is the model getting wrong?" without filtering noise out of the
   * provider rows.
   *
   * Rejections are audited rather than merely returned because they are the
   * signal that a tool boundary is being probed — a proto-polluting key or a
   * `..` traversal is worth seeing in the trail even when the loop simply
   * recovered and carried on.
   *
   * @param record - Which tool, which side of `execute`, which check, and why
   */
  recordValidationFailure(record: AiValidationFailureRecord): void {
    this.#enqueue({
      id: record.id ?? newAuditId(),
      ts: record.ts ?? nowIso(),
      provider: 'validation',
      model: 'n/a',
      promptVersion: '',
      task: VALIDATION_TASK,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      finishReason: 'stop',
      toolNames: [record.tool],
      validation: {
        tool: record.tool,
        stage: record.stage,
        kind: record.kind,
        ...(record.location !== undefined ? { location: record.location } : {}),
        ...(record.size !== undefined ? { size: record.size } : {}),
        ...(record.max !== undefined ? { max: record.max } : {}),
        reason: redactAuditText(record.reason),
      },
    });
  }

  #enqueue(call: AiCallAudit): void {
    try {
      const safe: AiCallAudit = {
        ...call,
        ...(call.error !== undefined ? { error: redactProviderError(call.error) } : {}),
        toolNames: [...call.toolNames],
      };
      this.#pending.push(safe);
      if (this.#pending.length > MAX_PENDING) {
        this.#pending.shift();
        this.#dropped++;
        logger.warn({ dropped: this.#dropped }, 'ai audit: buffer full, dropping oldest call');
      }
      if (this.#pending.length >= this.#flushEvery) {
        this.flush();
      }
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.#dropped++;
      logger.error({ err: detail }, 'ai audit: record failed');
    }
  }

  /**
   * Write every buffered call inside one transaction.
   *
   * On failure the batch is re-queued for the next flush (bounded by
   * `MAX_PENDING`) and the error is logged — never thrown.
   *
   * @returns Number of rows written
   */
  flush(): number {
    if (this.#pending.length === 0) return 0;
    const batch = this.#pending;
    this.#pending = [];

    try {
      this.#db.exec('BEGIN');
      let written = 0;
      for (const call of batch) {
        const result = dbRun(
          this.#db,
          INSERT_SQL,
          call.id,
          call.ts,
          call.provider,
          call.model,
          call.promptVersion,
          call.task,
          call.inputTokens,
          call.outputTokens,
          call.costUsd,
          call.latencyMs,
          call.finishReason,
          call.error !== undefined ? JSON.stringify(call.error) : null,
          JSON.stringify(call.toolNames),
          call.switch !== undefined ? JSON.stringify(call.switch) : null,
          call.question !== undefined ? JSON.stringify(call.question) : null,
          call.policy !== undefined ? JSON.stringify(call.policy) : null,
          call.validation !== undefined ? JSON.stringify(call.validation) : null
        );
        if (result.isErr()) {
          throw new Error(stitchErrorMessage(result.error));
        }
        written++;
      }
      this.#db.exec('COMMIT');
      return written;
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      logger.error({ err: detail, batch: batch.length }, 'ai audit: flush failed');
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // No active transaction — nothing to undo.
      }
      this.#pending = [...batch, ...this.#pending].slice(-MAX_PENDING);
      this.#dropped += Math.max(0, batch.length - this.#pending.length);
      return 0;
    }
  }

  /**
   * Read audited calls, newest first.
   *
   * Never throws: a failed read yields an empty list (the caller is a
   * dashboard, not a gate).
   *
   * @param filter - task/model/since/limit filters
   */
  async query(filter: AiCallQuery = {}): Promise<AiCallAudit[]> {
    const where: string[] = [];
    const params: SQLiteValue[] = [];
    if (filter.task !== undefined) {
      where.push('task = ?');
      params.push(filter.task);
    }
    if (filter.model !== undefined) {
      where.push('model = ?');
      params.push(filter.model);
    }
    if (filter.since !== undefined) {
      where.push('ts >= ?');
      params.push(filter.since);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const requested = filter.limit ?? DEFAULT_QUERY_LIMIT;
    const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.floor(requested)));
    const sql = `SELECT * FROM ai_calls${clause} ORDER BY ts DESC, id DESC LIMIT ?`;
    params.push(limit);

    const rows = dbAll(this.#db, sql, ...params);
    if (rows.isErr()) {
      logger.error({ err: stitchErrorMessage(rows.error) }, 'ai audit: query failed');
      return [];
    }
    return rows.value.map(rowToAudit);
  }

  /**
   * Sum of `cost_usd` across audited calls, optionally since a timestamp.
   * Never throws — a failed read yields 0.
   */
  async costTotal(since?: string): Promise<number> {
    const sql =
      since !== undefined
        ? 'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_calls WHERE ts >= ?'
        : 'SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_calls';
    const row = since !== undefined ? dbGet(this.#db, sql, since) : dbGet(this.#db, sql);
    if (row.isErr()) {
      logger.error({ err: stitchErrorMessage(row.error) }, 'ai audit: costTotal failed');
      return 0;
    }
    return asNumber(row.value?.total, 0);
  }

  /** Flush anything buffered. Does not close the database. */
  close(): void {
    this.flush();
  }

  /**
   * Drain the buffer when the process is asked to stop.
   *
   * Opt-in: a library that installs signal handlers by default leaks listeners
   * in every test that opens an audit log. The job runner (P-238) wires this.
   *
   * @returns A function that removes the listeners again
   */
  flushOnSignals(signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']): () => void {
    const handler = (): void => {
      this.flush();
    };
    for (const signal of signals) {
      process.on(signal, handler);
    }
    return () => {
      for (const signal of signals) {
        process.off(signal, handler);
      }
    };
  }
}

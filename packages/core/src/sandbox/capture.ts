// P-173 — Sandbox: capture logs and artifacts.
//
// Debugging a failed stitch and completing provenance (P-181/SBOM P-183) need
// the logs and build/test artifacts a container produced. This phase formalises
// capture so both are reproducible post-hoc:
//
//   - a BOUNDED RING BUFFER per run (default 10_000 lines), keeping the newest
//     lines on overflow and reporting how many were dropped — bounded memory,
//     not truncation (the handoff's explicit requirement);
//   - every line stamped with an ISO timestamp so a re-run can be diffed
//     (also the handoff's requirement), while the spec's plain `string[]` shape
//     stays available via {@link CaptureManager.logs};
//   - artifact extraction into `<hostDir>/<runId>/`, traversal-sanitised and
//     bounded by a byte budget;
//   - run metadata persisted through a `DbLike` table created on first use —
//     the arrangement P-145 (`ai_calls`), P-160 (`hil_requests`) and P-169
//     (`sandbox_images`) already use, because `store/schema.ts`'s header
//     reserves its own migration slots for later phases (P-239 owns the real
//     `JobRecord` this metadata is destined for).
//
// The client seam is narrow and structural, as in P-169–P-172.

import { ok, err, type Result } from 'neverthrow';
import { stat } from 'node:fs/promises';
import { type StitchError } from '../result/index.js';
import { dbAll, dbRun, type DbLike, type SQLiteValue } from '../store/schema.js';
import {
  scanArtifactFile,
  scanArtifactName,
  scrubSecrets,
  type SecretScanWarning,
} from './secrets.js';

/** Default ring-buffer capacity, in lines. */
export const DEFAULT_LOG_CAPACITY = 10_000;

/** Default artifact byte budget (100 MB, the phase's default). */
export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

/** The capture metadata table (created on first use). */
export const CAPTURE_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS capture_runs (
  run_id TEXT PRIMARY KEY,
  log_offset INTEGER NOT NULL,
  dropped INTEGER NOT NULL,
  artifacts TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;

/** One captured log line. */
export interface LogEntry {
  /** ISO timestamp, so two runs can be diffed line by line. */
  ts: string;
  line: string;
}

/** The writer `bindRun` hands back: feed it lines, it buffers them. */
export interface LogSink {
  stream(line: string): void;
}

/** What `capture` reports on success. */
export interface CaptureResult {
  runId: string;
  /** The retained lines, oldest first. */
  logs: string[];
  /** Bytes of the retained lines (UTF-8). */
  sizeBytes: number;
  /** Lines discarded by the ring buffer. */
  dropped: number;
}

/** Persisted capture metadata (runId, log offset, artifact paths). */
export interface CaptureRunRecord {
  runId: string;
  logOffset: number;
  dropped: number;
  artifacts: string[];
  updatedAt: string;
}

/** What `capture` needs from a container client. */
export interface CaptureClient {
  logs(containerOrId: string): Promise<Result<{ stdout: string[]; stderr: string[] }, StitchError>>;
  followLogs(containerOrId: string): Promise<Result<NodeJS.ReadableStream, StitchError>>;
  copyFrom(
    containerOrId: string,
    containerPath: string,
    hostDir: string
  ): Promise<Result<string, StitchError>>;
}

/** Options for {@link CaptureManager}. */
export interface CaptureOptions {
  /** Ring-buffer capacity per run. Default {@link DEFAULT_LOG_CAPACITY}. */
  logCapacity?: number;
  /** Total artifact byte budget per run. Default {@link DEFAULT_MAX_ARTIFACT_BYTES}. */
  maxArtifactBytes?: number;
  /** Optional persistence. Without it, capture is in-memory only. */
  db?: DbLike;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /**
   * P-179: secret VALUES in scope for every run, scrubbed from each line at
   * ingress. Per-run values can be added via {@link CaptureManager.bindRun}.
   */
  secrets?: readonly string[];
  /**
   * P-179: receives an artifact warning when a name (or, when enabled, a
   * content prefix) looks secret-bearing. A callback rather than a return
   * value, so `extractArtifacts` keeps its signature and a warning can never
   * fail a capture that otherwise succeeded.
   */
  onWarning?: (warning: SecretScanWarning) => void;
  /**
   * P-179: `config.sandbox.secretScanArtifacts`. When `true`, a BOUNDED prefix
   * of each copied artifact is scanned for credential shapes. Default `false`:
   * artifacts are otherwise checked by NAME only.
   */
  scanArtifactContent?: boolean;
}

/** Options for {@link CaptureManager.capture}. */
export interface CaptureRunOptions {
  /**
   * How the container's output is laid out. `docker` (default) reads the
   * demultiplexed stdout/stderr lines; `json` treats the raw stream as
   * newline-delimited records (a runner's JSON-lines output).
   */
  format?: 'docker' | 'json';
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A path segment that cannot traverse: no separators, no `..`, no drive.
 *
 * Reused for both the run id and each artifact name so `<hostDir>/<runId>/`
 * can never be escaped by a crafted id or a container path.
 */
export function sanitizeSegment(value: string): Result<string, StitchError> {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed === '') {
    return err({ code: 'CONFIG_ERROR', field: 'name', message: 'capture: name must not be empty' });
  }
  if (
    trimmed.includes('/') ||
    trimmed === '..' ||
    trimmed === '.' ||
    /^[a-zA-Z]:/.test(trimmed) ||
    trimmed.includes('\u0000')
  ) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'name',
      message: `capture: refusing "${value}" (path traversal)`,
    });
  }
  return ok(trimmed);
}

/** `<hostDir>/<runId>` — the run-scoped directory, with a safe run segment. */
function runDirFor(hostDir: string, safeRunId: string): string {
  return joinSegments(hostDir, safeRunId);
}

/** Join path segments with the separator the base already uses. */
function joinSegments(base: string, ...segments: string[]): string {
  const trimmed = base.replace(/[/\\]+$/, '');
  const sep = trimmed.includes('\\') ? '\\' : '/';
  return [trimmed, ...segments].join(sep);
}

/** `<hostDir>/<runId>/<name>` with both segments sanitised. */
export function hostArtifactPath(
  hostDir: string,
  runId: string,
  name: string
): Result<string, StitchError> {
  const safeRun = sanitizeSegment(runId);
  if (safeRun.isErr()) return err(safeRun.error);
  const safeName = sanitizeSegment(name);
  if (safeName.isErr()) return err(safeName.error);
  return ok(joinSegments(hostDir, safeRun.value, safeName.value));
}

/**
 * Bounded, timestamped, per-run log capture plus artifact extraction.
 */
export class CaptureManager {
  readonly #capacity: number;
  readonly #maxArtifactBytes: number;
  readonly #db: DbLike | undefined;
  readonly #now: () => string;
  readonly #secrets: readonly string[];
  readonly #onWarning: ((warning: SecretScanWarning) => void) | undefined;
  readonly #scanArtifactContent: boolean;
  readonly #buffers = new Map<string, LogEntry[]>();
  readonly #dropped = new Map<string, number>();
  readonly #runSecrets = new Map<string, readonly string[]>();

  constructor(options: CaptureOptions = {}) {
    this.#capacity = Math.max(1, options.logCapacity ?? DEFAULT_LOG_CAPACITY);
    this.#maxArtifactBytes = Math.max(0, options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES);
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#secrets = options.secrets ?? [];
    this.#onWarning = options.onWarning;
    this.#scanArtifactContent = options.scanArtifactContent === true;
  }

  /**
   * Bind a run and return its writer.
   *
   * The returned sink is what `client.run`'s `onLog` (or a live
   * `followLogs` reader) feeds, so a run's output lands in one bounded buffer.
   * `secrets` are the values in scope for THIS run; they are merged with the
   * instance-wide list and scrubbed from every line at ingress.
   */
  bindRun(runId: string, secrets: readonly string[] = []): LogSink {
    this.#buffers.set(runId, []);
    this.#dropped.set(runId, 0);
    this.#runSecrets.set(runId, secrets);
    return { stream: (line: string): void => this.append(runId, line) };
  }

  /** The secret values in scope for one run. */
  #secretsFor(runId: string): readonly string[] {
    const perRun = this.#runSecrets.get(runId) ?? [];
    return perRun.length === 0 ? this.#secrets : [...this.#secrets, ...perRun];
  }

  /**
   * Append one line, dropping the oldest entries past the cap.
   *
   * P-179: the line is scrubbed BEFORE it enters the buffer, so no unscrubbed
   * text is ever retained, returned by {@link logs}, or persisted.
   */
  append(runId: string, line: string): void {
    const buffer = this.#buffers.get(runId) ?? [];
    buffer.push({ ts: this.#now(), line: scrubSecrets(line, this.#secretsFor(runId)) });
    while (buffer.length > this.#capacity) {
      buffer.shift();
      this.#dropped.set(runId, (this.#dropped.get(runId) ?? 0) + 1);
    }
    this.#buffers.set(runId, buffer);
  }

  /** The retained lines (the spec's `string[]` shape). */
  logs(runId: string): string[] {
    return (this.#buffers.get(runId) ?? []).map(entry => entry.line);
  }

  /** The retained entries WITH their ISO timestamps (re-run diffing). */
  entries(runId: string): LogEntry[] {
    return [...(this.#buffers.get(runId) ?? [])];
  }

  /** How many lines the ring buffer discarded for this run. */
  dropped(runId: string): number {
    return this.#dropped.get(runId) ?? 0;
  }

  /** Test-only: drop every in-memory buffer. */
  clear(): void {
    this.#buffers.clear();
    this.#dropped.clear();
    this.#runSecrets.clear();
  }

  /**
   * Drain a container's logs into the run's buffer.
   *
   * Keeps the NEWEST lines on overflow and reports the loss as
   * `SANDBOX_LOG_LIMIT` (the retained lines stay retrievable via
   * {@link logs}) — the operation partly succeeded, which is exactly what that
   * code exists to say, and the no-throw rule is why it is a `Result` rather
   * than a raise.
   */
  async capture(
    client: CaptureClient,
    runId: string,
    containerId: string,
    options: CaptureRunOptions = {}
  ): Promise<Result<CaptureResult, StitchError>> {
    const read =
      options.format === 'json'
        ? await this.#drainRaw(client, runId, containerId)
        : await this.#drainDemuxed(client, runId, containerId);
    if (read.isErr()) return err(read.error);

    const dropped = this.dropped(runId);
    const logs = this.logs(runId);
    if (dropped > 0) {
      return err({
        code: 'SANDBOX_LOG_LIMIT',
        runId,
        dropped,
        retained: logs.length,
        message: `run ${runId} produced more than ${this.#capacity} log lines; ${dropped} dropped, ${logs.length} retained`,
      });
    }
    return ok({ runId, logs, sizeBytes: Buffer.byteLength(logs.join('\n'), 'utf8'), dropped });
  }

  /** The `docker` format: the client's demultiplexed stdout/stderr lines. */
  async #drainDemuxed(
    client: CaptureClient,
    runId: string,
    containerId: string
  ): Promise<Result<void, StitchError>> {
    const read = await client.logs(containerId);
    if (read.isErr()) return err(read.error);
    for (const line of read.value.stdout) this.append(runId, line);
    for (const line of read.value.stderr) this.append(runId, line);
    return ok(undefined);
  }

  /** The `json` format: the raw stream, split on newlines without demuxing. */
  async #drainRaw(
    client: CaptureClient,
    runId: string,
    containerId: string
  ): Promise<Result<void, StitchError>> {
    const followed = await client.followLogs(containerId);
    if (followed.isErr()) return err(followed.error);
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      followed.value.on('data', (chunk: unknown) => {
        const text =
          typeof chunk === 'string' ? chunk : Buffer.from(chunk as Buffer).toString('utf8');
        for (const line of text.split('\n')) if (line !== '') this.append(runId, line);
      });
      followed.value.on('error', finish);
      followed.value.on('end', finish);
      // A stream that already ended before we attached never fires 'end'.
      if (typeof (followed.value as { readableEnded?: boolean }).readableEnded === 'boolean') {
        if ((followed.value as { readableEnded?: boolean }).readableEnded === true) finish();
      }
    });
    return ok(undefined);
  }

  /**
   * Copy container paths into `<hostDir>/<runId>/`, bounded and sanitised.
   *
   * Each container path is reduced to its basename and must be a safe segment;
   * the cumulative written size is checked against the byte budget, so a huge
   * output tree cannot fill the host. Metadata is persisted when a `db` is set.
   */
  async extractArtifacts(
    client: CaptureClient,
    runId: string,
    containerId: string,
    containerPaths: readonly string[],
    hostDir: string
  ): Promise<Result<string[], StitchError>> {
    const safeRun = sanitizeSegment(runId);
    if (safeRun.isErr()) return err(safeRun.error);

    const extracted: string[] = [];
    let bytes = 0;
    for (const containerPath of containerPaths) {
      const name =
        containerPath
          .replace(/[/\\]+$/, '')
          .split(/[/\\]/)
          .pop() ?? '';
      const target = hostArtifactPath(hostDir, safeRun.value, name);
      if (target.isErr()) return err(target.error);

      // P-179: a suspicious NAME is worth a warning before a single byte is
      // copied — cheap, and it catches `cp ~/.ssh/id_rsa .` outright.
      const nameWarning = scanArtifactName(name);
      if (nameWarning !== undefined) this.#onWarning?.(nameWarning);

      // `copyFrom` writes `<dir>/<basename>.tar`; give it the run-scoped dir.
      const copied = await client.copyFrom(
        containerId,
        containerPath,
        runDirFor(hostDir, safeRun.value)
      );
      if (copied.isErr()) return err(copied.error);

      // P-179: content scanning is opt-in and BOUNDED, so a 100 MB tar cannot
      // turn a safety feature into a memory hazard. Warnings never fail the copy.
      if (this.#scanArtifactContent) {
        const scanned = await scanArtifactFile(copied.value);
        if (scanned.isOk()) for (const warning of scanned.value) this.#onWarning?.(warning);
      }

      const size = await fileSize(copied.value);
      bytes += size;
      if (bytes > this.#maxArtifactBytes) {
        return err({
          code: 'SANDBOX_ARTIFACT_LIMIT',
          runId: safeRun.value,
          bytes,
          limitBytes: this.#maxArtifactBytes,
          message: `run ${safeRun.value} artifacts exceeded ${this.#maxArtifactBytes} bytes (${containerPath})`,
        });
      }
      extracted.push(copied.value);
    }

    const persisted = this.#persist({
      runId: safeRun.value,
      artifacts: extracted,
      dropped: this.dropped(safeRun.value),
    });
    if (persisted.isErr()) return err(persisted.error);
    return ok(extracted);
  }

  /** Read persisted metadata for one run (`null` when never captured). */
  getRun(runId: string): Result<CaptureRunRecord | null, StitchError> {
    if (this.#db === undefined) return ok(null);
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    const rows = dbAll(
      this.#db,
      'SELECT run_id, log_offset, dropped, artifacts, updated_at FROM capture_runs WHERE run_id = ?',
      runId
    );
    if (rows.isErr()) return err(rows.error);
    const row = rows.value[0];
    if (row === undefined) return ok(null);
    return parseRecord(row);
  }

  /** Upsert the run's capture metadata. In-memory only without a `db`. */
  #persist(input: {
    runId: string;
    artifacts: string[];
    dropped: number;
  }): Result<void, StitchError> {
    if (this.#db === undefined) return ok(undefined);
    const ready = this.#ensureTable();
    if (ready.isErr()) return err(ready.error);
    return dbRun(
      this.#db,
      `INSERT INTO capture_runs (run_id, log_offset, dropped, artifacts, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         log_offset = excluded.log_offset,
         dropped = excluded.dropped,
         artifacts = excluded.artifacts,
         updated_at = excluded.updated_at`,
      input.runId,
      this.logs(input.runId).length,
      input.dropped,
      JSON.stringify(input.artifacts),
      this.#now()
    ).map(() => undefined);
  }

  #ensureTable(): Result<void, StitchError> {
    if (this.#db === undefined) return ok(undefined);
    try {
      this.#db.exec(CAPTURE_RUNS_TABLE_SQL);
      return ok(undefined);
    } catch (cause: unknown) {
      return err({
        code: 'INTERNAL',
        message: `capture_runs table setup failed: ${detailOf(cause)}`,
      });
    }
  }
}

/** Bytes of a written archive; a missing file counts as 0 rather than failing. */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** Shape one `capture_runs` row. */
function parseRecord(row: Record<string, SQLiteValue>): Result<CaptureRunRecord, StitchError> {
  const rawArtifacts = row['artifacts'];
  let artifacts: string[] = [];
  if (typeof rawArtifacts === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawArtifacts);
      if (Array.isArray(parsed))
        artifacts = parsed.filter((v): v is string => typeof v === 'string');
    } catch {
      return err({ code: 'INTERNAL', message: 'capture_runs.artifacts is not valid JSON' });
    }
  }
  return ok({
    runId: String(row['run_id'] ?? ''),
    logOffset: Number(row['log_offset'] ?? 0),
    dropped: Number(row['dropped'] ?? 0),
    artifacts,
    updatedAt: String(row['updated_at'] ?? ''),
  });
}

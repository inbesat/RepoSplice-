// P-194 — `stitch status`: the read-only workspace dashboard.
//
// One read pass over the project + user state, rendered as text or JSON, and it
// exits 0 always: the phase defines the command as informational, so a read
// failure is REPORTED inside its section rather than becoming an exit code — a
// dashboard that dies on one bad section tells the user less than one that
// labels the section.
//
// Read-only in the strong sense:
//   - the SQLite state db (`~/.stitch/<STITCH_STORE_FILENAME>`) is opened
//     READ-ONLY and only when the file already exists — a readonly SQLite open
//     on a missing path would CREATE it, and `openDb` runs migrations, which
//     must never become a side effect of a status call;
//   - `HilQueue`'s constructor and `ProvenanceAudit`'s lazy `#ensureTable` run
//     CREATE-IF-NOT-EXISTS DDL, so both are constructed only AFTER a
//     `sqlite_master` pre-check confirms their tables exist (the DDL is a
//     no-op then). `status` never writes tables into a store the user did not
//     ask it to touch;
//   - the user config store (`~/.stitch/config.json`) is only opened when the
//     file exists too — `openStore` intentionally creates it, which is a
//     write.
//
// Deviations from the phase's bullet text, recorded as ADR-079:
//   1. "run verifyChecksums" is not directly drivable from the persisted
//      `checksums.sha256`: `verifyChecksums` (P-186) takes a `ChecksumManifest`
//      object (with `sizeBytes` and `manifestSha256`), but the P-186 file
//      format (`renderChecksumFile`) stores only `<sha256>  <path>` lines.
//      Status therefore re-hashes each recorded path against its recorded
//      digest and reports `verified` / `drift` (plus `unreadable` for a corrupt
//      or partial manifest — a third state the phase's two words don't cover).
//   2. `config.sandbox.dockerHost` is interpreted as a socket path when it
//      starts with `/`, else as a tcp host — the two shapes
//      `createDockerClient` (docker.ts) accepts, and the only two the config
//      field's documented values take.
//   3. "provider" = which provider has a configured credential: a
//      `<provider>.apiKey` entry in the user store (`init --provider` writes
//      exactly that shape) or the documented env var (`PROVIDER_ENV_KEYS`).
//      The key VALUE is never read: the store is consulted through
//      `snapshotRedacted`, so nothing secret can reach the output.
//   4. Nothing parses `stitch.toml` yet (no TOML reader exists in the repo), so
//      the config path is printed with its presence; `provider` / `model` come
//      from `loadConfig()`'s defaults+env layer (P-200) and the store.
//
// Injection models the `serve.ts` pattern: every environmental edge (store
// dirs, the db open, the docker probe, the write sink) is a named dependency,
// so tests run the real logic on an injected `node:sqlite` db and temp dirs.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import {
  CHECKSUM_MANIFEST_FILENAME,
  ProvenanceAudit,
  SandboxClient,
  HilQueue,
  defaultStorePath,
  defaultConfig,
  fallbackSelection,
  loadConfig,
  openDb,
  type DbLike,
  type HilKind,
  type SelectionSource,
  type StitchError,
} from '@repo-stitcher/core';
import { CONFIG_FILE } from './init.js';
import type { GlobalOptions } from '../globals.js';
import {
  STITCH_CONFIG_FILE,
  defaultStoreDir,
  openStore,
  providerNames,
  readSources,
  type StitchStore,
} from '../config.js';
import { theme, type ThemeLevel } from '../theme.js';
import {
  formatConfidenceSummary,
  parseConfidenceSummary,
  type ConfidenceSummary,
} from '../ui/confidence-summary.js';

/** How many audit actions count as "recent activity" (the phase's `last N`). */
export const RECENT_AUDIT_LIMIT = 5;

/** Options the commander action hands in: the globals plus `--json`. */
export interface StatusOptions extends GlobalOptions {
  json?: boolean;
}

/** One `sources` row as emitted. `paths` is a COUNT (the phase's wording). */
export interface StatusSourceRow {
  source: string;
  paths: number;
  ref?: string;
}

/** The `checksums.sha256` verdict (ADR-079 point 1). */
export type ChecksumVerdict =
  | { state: 'no-manifest' }
  | { state: 'verified' }
  | { state: 'drift'; mismatches: string[] }
  | { state: 'unreadable'; detail: string };

/** The structured object `--json` emits. Its shape is a consumer contract. */
export interface StatusReport {
  config: {
    path: string;
    present: boolean;
    /** The durable user config (`~/.stitch/config.json`), never the secret values. */
    store: string;
    /** False means the store file does not exist (status refused to create it). */
    storePresent: boolean;
    storeError?: string;
    /** The SQLite state db the HIL / jobs / audit sections read from. */
    stateDb: string;
    stateDbPresent: boolean;
    providers: string[];
    model: string | null;
    projectDir: string;
    configError?: string;
  };
  sources: StatusSourceRow[];
  sourcesError?: string;
  hil: { pending: Record<HilKind, number>; total: number } | null;
  hilError?: string;
  jobs: {
    running: Array<{ id: string; kind: string; startedAt: string | null }>;
    recent: Array<{ ts: string; action: string; actor: string; jobId: string | null; ok: boolean }>;
  } | null;
  jobsError?: string;
  sandbox: {
    docker: 'available' | 'unavailable' | 'probe-failed';
    ghFallback: boolean;
    detail?: string;
  };
  checksums: ChecksumVerdict;
  /**
   * The recorded confidence assessment for the current job (P-353).
   *
   * Absent or null when the job has no persisted assessment; the renderer
   * prints the honest `N/A` line rather than inventing a number.
   */
  readonly confidence?: ConfidenceSummary | null;
}

/** Everything environmental, injected. Defaults are the real edges. */
export interface StatusDeps {
  /** The user config store directory (sources + provider keys). Default `~/.stitch`. */
  storeDir?: string;
  /** The SQLite state db path (HIL / jobs / audit). Default `defaultStorePath()`. */
  storePath?: string;
  /** Default: core's `openDb(path, { readonly: true })`, mapped to its `DbLike` raw. */
  openStoreDb?: (path: string) => Promise<Result<DbLike, StitchError>>;
  /** Default: a real probe through `SandboxClient` (never throws, per its contract). */
  probeSandbox?: () => Promise<boolean>;
  /**
   * The recorded confidence assessment for the current job, when one exists
   * (P-353's seam: a later phase threads the job store's record here).
   */
  confidence?: unknown;
  /** Default: one line at a time to stdout. */
  write?: (line: string) => void;
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Brief message for a section error note. Mirrors core's `stitchErrorMessage`
 * (result/index.ts:318): not every StitchError variant carries `message`, and
 * the accessor is not barrel-exported (the barrel currently carries foreign
 * uncommitted edits, so extending it is not this phase's call).
 * shortcut: import from the barrel once core exports it.
 */
export function messageOf(error: StitchError): string {
  const candidate = (error as { readonly message?: unknown }).message;
  return typeof candidate === 'string' ? candidate : error.code;
}

/** The default real db edge. `{ readonly: true }` keeps this a pure read. */
async function defaultOpenStoreDb(path: string): Promise<Result<DbLike, StitchError>> {
  const opened = await openDb(path, { readonly: true });
  if (opened.isErr()) return err(opened.error);
  // The same assignment `store/db.ts` itself makes (`const db: DbLike = raw`).
  return ok(opened.value.raw);
}

// ---------------------------------------------------------------------------
// checksums.sha256 — read + verify (ADR-079 point 1)
// ---------------------------------------------------------------------------

/** One recorded entry, parsed from the sha256sum-format file. */
export interface ParsedChecksumEntry {
  path: string;
  sha256: string;
}

/**
 * Parse the P-186 file format (`<64 hex>␠␠<relative path>`, one per line) —
 * exactly what {@link renderChecksumFile} writes. Any other line is a corrupt
 * manifest, not silently skipped.
 */
export function parseChecksumFile(text: string): Result<ParsedChecksumEntry[], string> {
  const entries: ParsedChecksumEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(trimmed);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      return err(`not a sha256sum line: ${trimmed.slice(0, 48)}`);
    }
    entries.push({ sha256: match[1], path: match[2] });
  }
  if (entries.length === 0) return err('the manifest has no entries');
  return ok(entries);
}

/** Stream-hash one file (the same streaming shape `checksums.ts` uses). */
async function sha256File(absolutePath: string): Promise<Result<string, string>> {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(absolutePath)) {
      hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
  } catch (cause: unknown) {
    return err(`cannot hash ${absolutePath}: ${reasonOf(cause)}`);
  }
  return ok(hash.digest('hex'));
}

/** Verify the project's manifest against the recorded digests (file level). */
async function verifyChecksumFile(projectDir: string): Promise<ChecksumVerdict> {
  const manifestPath = join(projectDir, CHECKSUM_MANIFEST_FILENAME);
  let text: string;
  if (existsSync(manifestPath) === false) return { state: 'no-manifest' };
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (cause: unknown) {
    return { state: 'unreadable', detail: reasonOf(cause) };
  }
  const parsed = parseChecksumFile(text);
  if (parsed.isErr()) return { state: 'unreadable', detail: parsed.error };

  const mismatches: string[] = [];
  for (const entry of parsed.value) {
    const hashed = await sha256File(join(projectDir, entry.path));
    // A missing recorded file is a mismatch (the same rule verifyChecksums applies).
    if (hashed.isErr() || hashed.value !== entry.sha256) mismatches.push(entry.path);
  }
  mismatches.sort((a, b) => a.localeCompare(b));
  return mismatches.length === 0 ? { state: 'verified' } : { state: 'drift', mismatches };
}

// ---------------------------------------------------------------------------
// State db sections (HIL, jobs, recent audit activity)
// ---------------------------------------------------------------------------

/** All SQLite sections read from one open (read-only) handle. */
type DbSections = {
  hil: StatusReport['hil'];
  hilError?: string;
  jobs: StatusReport['jobs'];
  jobsError?: string;
};

/** Read-only table existence: a broken store reports an error, never a guess. */
function tableExists(db: DbLike, name: string): Result<boolean, string> {
  try {
    const row = db
      .query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', name);
    return ok(row !== null && String(row['name']) === name);
  } catch (cause: unknown) {
    return err(reasonOf(cause));
  }
}

/**
 * Read the HIL / jobs / audit sections.
 *
 * Each reader is constructed only after its table is confirmed (see the module
 * header), so the CREATE-IF-NOT-EXISTS DDL inside `HilQueue`'s constructor and
 * `ProvenanceAudit`'s query path is a no-op. Anything that fails surfaces as a
 * section error; nothing here writes.
 */
async function readDbSections(db: DbLike): Promise<DbSections> {
  const sections: DbSections = { hil: null, jobs: null };

  // -- HIL pending, count per kind.
  const hilTable = tableExists(db, 'hil_requests');
  if (hilTable.isErr()) {
    sections.hilError = hilTable.error;
  } else if (hilTable.value) {
    try {
      const pending = new HilQueue({ db }).pending();
      if (pending.isErr()) {
        sections.hilError = messageOf(pending.error);
      } else {
        const counts: Record<HilKind, number> = { component: 0, question: 0, permission: 0 };
        for (const request of pending.value) counts[request.kind] += 1;
        const total = counts['component'] + counts['question'] + counts['permission'];
        sections.hil = { pending: counts, total };
      }
    } catch (cause: unknown) {
      sections.hilError = reasonOf(cause);
    }
  }

  // -- Running jobs: the durable queue rows (P-239) are the queryable state.
  //    (P-247's metrics table is written at stage boundaries; the queue row is
  //    what survives a process restart — status must answer after one.)
  const running: Array<{ id: string; kind: string; startedAt: string | null }> = [];
  let runningError: string | undefined;
  const jobTable = tableExists(db, 'pipeline_jobs');
  if (jobTable.isErr()) {
    runningError = jobTable.error;
  } else if (jobTable.value) {
    try {
      const rows = db
        .query(
          'SELECT id, kind, started_at FROM pipeline_jobs WHERE status = ? ORDER BY started_at ASC'
        )
        .all('running');
      for (const row of rows) {
        running.push({
          id: String(row['id']),
          kind: String(row['kind']),
          startedAt: row['started_at'] === null ? null : String(row['started_at']),
        });
      }
    } catch (cause: unknown) {
      runningError = reasonOf(cause);
    }
  }

  // -- Recent audit activity (the phase's "last N action timestamps").
  const recent: Array<{
    ts: string;
    action: string;
    actor: string;
    jobId: string | null;
    ok: boolean;
  }> = [];
  let recentError: string | undefined;
  const auditTable = tableExists(db, 'provenance_audit');
  if (auditTable.isErr()) {
    recentError = auditTable.error;
  } else if (auditTable.value) {
    try {
      const read = await new ProvenanceAudit({ db }).query({ limit: RECENT_AUDIT_LIMIT });
      if (read.isErr()) {
        recentError = messageOf(read.error);
      } else {
        for (const record of read.value) {
          recent.push({
            ts: record.ts,
            action: record.action,
            actor: record.actor,
            jobId: record.jobId ?? null,
            ok: record.ok,
          });
        }
      }
    } catch (cause: unknown) {
      recentError = reasonOf(cause);
    }
  }

  // The jobs section appears exactly when its tables exist (possibly empty);
  // any failure is surfaced once, beside the data.
  if ((jobTable.isOk() && jobTable.value) || (auditTable.isOk() && auditTable.value)) {
    sections.jobs = { running, recent };
  }
  const jobsFault = runningError ?? recentError;
  if (jobsFault !== undefined) sections.jobsError = jobsFault;

  return sections;
}

// ---------------------------------------------------------------------------
// Section helpers that do not need the db
// ---------------------------------------------------------------------------

/** Does the config carry a usable GitHub credential (presence only — no network)? */
function hasGithubAuth(config: ReturnType<typeof loadConfig>): boolean {
  const github = config.github;
  if (github.authType === 'pat') return github.token !== undefined;
  return (
    github.appId !== undefined &&
    github.privateKeyPath !== undefined &&
    github.installationId !== undefined
  );
}

/**
 * providerNames lives in `config.ts` now (P-195): doctor shares it, and it
 * reads the store, so it belongs beside `readSources`/`StitchStore`.
 */

/** The docker line: probe the daemon, then decide the fallback state in core. */
async function sandboxSection(
  config: ReturnType<typeof loadConfig> | null,
  deps: StatusDeps
): Promise<StatusReport['sandbox']> {
  const selectionSource: SelectionSource = {
    ...(config?.sandbox?.mode !== undefined ? { mode: config.sandbox.mode } : {}),
    ...(config?.sandbox?.backend !== undefined ? { backend: config.sandbox.backend } : {}),
    ciConfigured: config?.ci !== undefined,
    hasAuth: config !== null && hasGithubAuth(config),
    // Asked at its worst: the fallback is "enabled" iff the GH path is usable
    // when docker is not. That single-definition lives in core (ADR-048).
    dockerAvailable: false,
  };
  const ghFallback = fallbackSelection(selectionSource) === 'github';

  let probe: Result<boolean, string>;
  if (deps.probeSandbox !== undefined) {
    try {
      probe = ok(await deps.probeSandbox());
    } catch (cause: unknown) {
      probe = err(reasonOf(cause));
    }
  } else {
    const dockerHost = config?.sandbox?.dockerHost;
    // A `/`-led value is a socket path (unix socket or npipe); anything else is
    // a tcp host (ADR-079 point 2).
    const usesSocket = dockerHost !== undefined && dockerHost.startsWith('/');
    const created =
      dockerHost === undefined
        ? SandboxClient.create({})
        : usesSocket
          ? SandboxClient.create({ socketPath: dockerHost })
          : SandboxClient.create({ host: dockerHost });
    if (created.isErr()) {
      probe = err(messageOf(created.error));
    } else {
      // The client's own contract: isAvailable NEVER throws/never rejects.
      probe = ok(await created.value.isAvailable());
    }
  }

  return probe.isOk()
    ? { docker: probe.value ? 'available' : 'unavailable', ghFallback }
    : { docker: 'probe-failed', ghFallback, detail: probe.error };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The paint used by every section (plain when `--no-color`). */
type Paint = (level: ThemeLevel, text: string) => string;

function renderHilLine(report: StatusReport): string {
  const hil = report.hil;
  if (hil === null) {
    return report.hilError !== undefined
      ? `hil: unavailable (error: ${report.hilError})`
      : 'hil: no HIL state yet';
  }
  if (hil.total === 0) return 'hil: none pending';
  const kinds = Object.keys(hil.pending) as HilKind[];
  const parts = kinds
    .filter(kind => hil.pending[kind] > 0)
    .map(kind => `${kind} ${String(hil.pending[kind])}`);
  return `hil: ${String(hil.total)} pending (${parts.join(', ')})`;
}

function renderJobsLines(report: StatusReport): string[] {
  if (report.jobs === null) {
    return [
      report.jobsError !== undefined
        ? `jobs: unavailable (error: ${report.jobsError})`
        : 'jobs: no pipeline state yet',
    ];
  }
  const running =
    report.jobs.running.length === 0
      ? 'none running'
      : report.jobs.running
          .map(job => {
            const started =
              job.startedAt !== null && job.startedAt !== '' ? `, started ${job.startedAt}` : '';
            return `${job.id} (${job.kind}${started})`;
          })
          .join('; ');
  const lines: string[] = [`jobs: ${running}`];
  lines.push(
    report.jobs.recent.length === 0
      ? 'recent activity: none'
      : `recent activity: ${report.jobs.recent
          .map(
            record =>
              `${record.action} @${record.ts} (${record.actor}${record.ok ? '' : ', failed'})`
          )
          .join(', ')}`
  );
  if (report.jobsError !== undefined) lines.push(`  (jobs error: ${report.jobsError})`);
  return lines;
}

function renderSandboxLine(report: StatusReport, paint: Paint): string {
  switch (report.sandbox.docker) {
    case 'available': {
      return `sandbox: docker ${paint('ok', 'available')}`;
    }
    case 'unavailable': {
      return `sandbox: docker ${paint('err', 'unavailable')} (gh-fallback ${
        report.sandbox.ghFallback ? 'enabled' : 'disabled'
      })`;
    }
    case 'probe-failed':
    default: {
      // `detail` always carries the probe failure so it is never hidden.
      return `sandbox: docker ${paint('warn', 'probe failed')} (${String(report.sandbox.detail)})`;
    }
  }
}

function renderChecksumsLine(report: StatusReport, paint: Paint): string {
  switch (report.checksums.state) {
    case 'verified': {
      return `checksums: ${paint('ok', 'verified')}`;
    }
    case 'drift': {
      return `checksums: ${paint('err', 'drift')} — ${report.checksums.mismatches.join(', ')}`;
    }
    case 'unreadable': {
      return `checksums: ${paint('err', 'unreadable')} (${report.checksums.detail})`;
    }
    case 'no-manifest':
    default: {
      return 'checksums: no manifest (no checksums.sha256 in the project dir)';
    }
  }
}

/** The text render. One string per line; the caller writes them. */
/** The confidence summary (always one line; the honest N/A when none is recorded). */
function renderConfidenceLines(report: StatusReport, paint: Paint): string[] {
  return formatConfidenceSummary(report.confidence ?? undefined, { paint });
}

export function renderStatusReport(report: StatusReport, paint: Paint): string[] {
  const config = report.config;
  const sources = report.sources.length === 0 ? 'none' : String(report.sources.length);
  const lines: string[] = [
    'stitch status',
    `config: ${config.path} (${config.present ? 'present' : 'not found'})`,
    `store: ${config.store} (${config.storePresent ? 'present' : 'not found'})${
      config.storeError !== undefined ? ` (error: ${config.storeError})` : ''
    }`,
    `state db: ${config.stateDb} (${config.stateDbPresent ? 'present' : 'absent'})`,
    `provider: ${config.providers.join(', ') || 'not configured'}`,
    `model: ${config.model ?? 'not set'}`,
    `project dir: ${config.projectDir}`,
    ...(config.configError !== undefined ? [`  (config load failed: ${config.configError})`] : []),
    `sources: ${sources}${
      report.sourcesError !== undefined ? ` (error: ${report.sourcesError})` : ''
    }`,
  ];
  for (const row of report.sources) {
    lines.push(
      `  - ${row.source} (${String(row.paths)} path${
        row.paths === 1 ? '' : 's'
      })${row.ref !== undefined ? ` @${row.ref}` : ''}`
    );
  }
  lines.push(renderHilLine(report));
  lines.push(...renderJobsLines(report));
  lines.push(...renderConfidenceLines(report, paint));
  lines.push(renderSandboxLine(report, paint));
  lines.push(renderChecksumsLine(report, paint));
  return lines;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * status: assemble the dashboard (single read pass, strictly read-only), then
 * render text or `--json`. Returns `ok(undefined)` so the exit code stays 0 on
 * every outcome — failures are section notes (the module header covers why).
 */
export async function status(
  opts: StatusOptions,
  deps: StatusDeps = {}
): Promise<Result<void, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  // `--no-color` opts out here; NO_COLOR / off-TTY are handled by `theme` itself.
  const paint: Paint =
    opts.color === false ? (_level, text) => text : (level, text) => theme(level, text);

  const projectDir = resolve(opts.cwd ?? process.cwd());
  const stateDbPath = deps.storePath ?? defaultStorePath();

  // 1. Config (P-200). `loadConfig` is synchronous and throwing; a failure is
  //    status information here, not a fatal code.
  let config: ReturnType<typeof loadConfig>;
  let configError: string | undefined;
  try {
    config = loadConfig();
  } catch (cause: unknown) {
    // Nothing in the repo builds the env layer that would carry a real GitHub
    // token yet (P-200's loader), so a bare `loadConfig()` throws on token-less
    // machines. The dashboard degrades to the same defaults loadConfig starts
    // from and keeps the reason visible — informational by mandate.
    config = defaultConfig;
    configError = reasonOf(cause);
  }
  const configPath = opts.configPath ?? join(projectDir, CONFIG_FILE);

  // 2. User config store: only opened when the file already exists —
  //    `openStore` intentionally creates it, and status writes nothing.
  const storeDir = deps.storeDir ?? defaultStoreDir();
  const storeFilePath = join(storeDir, STITCH_CONFIG_FILE);
  const storePresent = existsSync(storeFilePath);
  let store: Result<StitchStore, StitchError> | null = null;
  let storeError: string | undefined;
  if (storePresent) {
    store = openStore(storeDir);
    if (store.isErr()) storeError = messageOf(store.error);
  }

  // 3. Sources + providers (both live in the store; P-191 recorded these).
  let sources: StatusSourceRow[] = [];
  let sourcesError: string | undefined;
  if (store !== null && store.isOk()) {
    const read = readSources(store.value.get('sources'));
    if (read.isErr()) {
      sourcesError = messageOf(read.error);
    } else {
      sources = read.value.map(selection => ({
        source: selection.source,
        paths: selection.paths.length,
        ...(selection.ref !== undefined ? { ref: selection.ref } : {}),
      }));
    }
  }

  // 4. The state db: exist-check FIRST, open second, close at the end.
  const stateDbPresent = existsSync(stateDbPath);
  let db: DbLike | null = null;
  let dbError: string | undefined;
  if (stateDbPresent) {
    const openedStoreDb = deps.openStoreDb ?? ((path: string) => defaultOpenStoreDb(path));
    // The injected opener is caller code — a rejection must never escape
    // status (no-throw mandate); it degrades like any other section failure.
    try {
      const openedDb = await openedStoreDb(stateDbPath);
      if (openedDb.isErr()) {
        dbError = messageOf(openedDb.error);
      } else {
        db = openedDb.value;
      }
    } catch (cause: unknown) {
      dbError = reasonOf(cause);
    }
  }
  const sections: DbSections =
    db === null
      ? {
          hil: null,
          jobs: null,
          ...(dbError !== undefined ? { hilError: dbError, jobsError: dbError } : {}),
        }
      : await readDbSections(db);
  if (db !== null) {
    try {
      db.close();
    } catch {
      // Closing a read handle is best-effort; the dashboard never fails on it.
    }
  }

  // 5. Sandbox availability + fallback posture, then the checksum verdict.
  const sandbox = await sandboxSection(config, deps);
  const checksums = await verifyChecksumFile(projectDir);

  const report: StatusReport = {
    config: {
      path: configPath,
      present: existsSync(configPath),
      store: storeFilePath,
      storePresent,
      ...(storeError !== undefined ? { storeError } : {}),
      stateDb: stateDbPath,
      stateDbPresent,
      providers: providerNames(storePresent ? store : null),
      model: config === null ? null : (config.openrouter.defaultModel ?? null),
      projectDir,
      ...(configError !== undefined ? { configError } : {}),
    },
    sources,
    ...(sourcesError !== undefined ? { sourcesError } : {}),
    hil: sections.hil,
    ...(sections.hilError !== undefined ? { hilError: sections.hilError } : {}),
    jobs: sections.jobs,
    ...(sections.jobsError !== undefined ? { jobsError: sections.jobsError } : {}),
    sandbox,
    checksums,
    confidence: parseConfidenceSummary(deps.confidence) ?? null,
  };

  if (opts.json === true) {
    write(JSON.stringify(report, null, 2));
    return ok(undefined);
  }
  for (const line of renderStatusReport(report, paint)) write(line);
  return ok(undefined);
}

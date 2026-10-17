// P-207 — `stitch audit`: the compliance read-side over the audit logs.
//
// Two sources, both read through the SAME state db (`stitch.db`):
//   • `provenance_audit` — core's `ProvenanceAudit` (P-187), the pipeline's
//     append-only event log (who/what/when/ok).
//   • `ai_calls` — core's `AiAuditLog` (P-145), the AI-call log (model,
//     tokens, cost, finish).
//
// READ-ONLY BY CONSTRUCTION, three ways: the db file must already EXIST
// (a missing path is "nothing recorded yet", exit 0 — the P-194 precedent of
// never creating state from a read command), the connection opens with
// `{ readonly: true }` (no migrations, per the status.ts note), and the audit
// classes expose no mutation this command calls.
//
// ON THE FILTERS: core's `query` knows `since`/`actor` but has no upper bound,
// so `--to` is applied CLI-side after the read. `--no-ai` hides the `ai_calls`
// section (P-145 rows are in the OTHER table, not related rows here).

import { existsSync } from 'node:fs';
import { err, ok, type Result } from 'neverthrow';
import {
  AiAuditLog,
  type AiCallAudit,
  defaultStorePath,
  openDb,
  ProvenanceAudit,
  type AuditRecord,
  type DbLike,
  type StitchError,
} from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';
import { theme } from '../theme.js';

/** What the command accepts, on top of the globals. */
export interface AuditOptions extends GlobalOptions {
  /** `--from <ts>`: inclusive lower bound (ISO string). */
  from?: string;
  /** `--to <ts>`: inclusive upper bound (ISO string) — applied read-side here. */
  to?: string;
  /** `--actor <who>`: only rows by this actor. */
  actor?: string;
  /** `--export <format>`: `json` (machine) or `md` (markdown report). */
  export?: string;
  /** `--no-ai`: hide the P-145 AI-call section. */
  noAi?: boolean;
  /** `--follow, -f`: tail new records until interrupted (used with `serve`). */
  follow?: boolean;
  /** The state db path override (tests; default `defaultStorePath()`). */
  storePath?: string;
}

/** Everything environmental, injected (mirrors `StatusDeps`). */
export interface AuditDeps {
  /** Where the report/table goes. Default: one line at a time to stdout. */
  write?: (line: string) => void;
  /** The SQLite state db path. Default `defaultStorePath()`. */
  storePath?: string;
  /** Existence probe. Default `existsSync`. */
  exists?: (path: string) => boolean;
  /**
   * Default: core's `openDb(path, { readonly: true })`, mapped to its `DbLike`
   * raw — the status.ts pattern that cannot create or migrate anything.
   */
  openStateDb?: (path: string) => Promise<Result<DbLike, StitchError>>;
  /** Follow-loop: pause between polls. Default 2s. */
  everyMs?: number;
  /** Follow-loop: the stop switch (default: never — SIGINT ends the process). */
  stop?: (iteration: number) => boolean;
  /** Follow-loop: the pause itself. Default a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** The rendered report's payload — also what `--export json` emits. */
export interface AuditReport {
  records: AuditRecord[];
  aiCalls: AiCallAudit[];
  /** Rows per action kind, in first-seen order. */
  countByAction: Record<string, number>;
  /** The most recent `merge` row, for the "last merge" summary line. */
  lastMerge?: AuditRecord;
  /** The most recent `checksum` row (P-186's verified state). */
  lastChecksum?: AuditRecord;
}

/** The default real db edge: readonly, mapped to `DbLike` (status.ts's shape). */
async function defaultOpenStateDb(path: string): Promise<Result<DbLike, StitchError>> {
  const opened = await openDb(path, { readonly: true });
  if (opened.isErr()) return err(opened.error);
  return ok(opened.value.raw);
}

/** One line of detail, compact: the JSON, capped, with an ellipsis when cut. */
function detailBrief(detail: Record<string, unknown>, max = 80): string {
  const text = JSON.stringify(detail);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Chronological (the core read is newest-first; the table reads oldest-first). */
function chronological(records: AuditRecord[]): AuditRecord[] {
  return [...records].reverse();
}

/** Group rows by action kind, preserving first-seen order. */
function countByKind(records: AuditRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.action] = (counts[record.action] ?? 0) + 1;
  }
  return counts;
}

/** The inclusive `--to` bound, applied after the read (core filters `since` only). */
function withinTo(records: AuditRecord[], to: string | undefined): AuditRecord[] {
  if (to === undefined) return records;
  return records.filter(record => record.ts <= to);
}

/** Colour by kind (P-202): happy actions green, sad red, everything else plain. */
function kindLevel(action: AuditRecord['action']): 'ok' | 'err' | undefined {
  if (['approve', 'publish', 'commit', 'push', 'init', 'clone'].includes(action)) return 'ok';
  if (['reject', 'cancel', 'rollback'].includes(action)) return 'err';
  return undefined;
}

/** Format one provenance row: `ts | actor | action | job | mark | detail`. */
function formatRecord(record: AuditRecord): string {
  const mark = record.ok ? 'ok' : 'FAIL';
  const job = record.jobId === undefined ? '' : ` [${record.jobId}]`;
  return `${record.ts}  ${record.actor}  ${record.action}${job}  ${mark}  ${detailBrief(record.detail)}`;
}

/** Format one AI row: `ts | model | tokens | cost | finish`. */
function formatAiCall(call: AiCallAudit): string {
  return `${call.ts}  ${call.model}  in=${call.inputTokens} out=${call.outputTokens}  $${call.costUsd.toFixed(4)}  ${call.finishReason}`;
}

/**
 * The success summary: counts by kind, the last merge, the checksum verdict.
 */
function summaryLines(report: AuditReport): string[] {
  const lines = ['Summary by kind:'];
  for (const [kind, count] of Object.entries(report.countByAction)) {
    lines.push(`  ${kind}: ${count}`);
  }
  if (report.lastMerge !== undefined) {
    lines.push(
      `Last merge: ${report.lastMerge.ts} by ${report.lastMerge.actor}` +
        ` (${report.lastMerge.ok ? 'completed' : 'failed'})`
    );
  }
  if (report.lastChecksum !== undefined) {
    lines.push(
      `Checksums: ${report.lastChecksum.ok ? 'verified' : 'NOT verified'}` +
        ` (${report.lastChecksum.ts})`
    );
  }
  return lines;
}

/** `--export md`: a markdown compliance report (headers + tables) for PR pastes. */
export function auditMarkdown(report: AuditReport): string {
  const lines: string[] = ['# Stitch audit report', ''];
  lines.push('## Provenance events', '');
  lines.push('| timestamp | actor | action | job | ok | detail |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const record of report.records) {
    lines.push(
      `| ${record.ts} | ${record.actor} | ${record.action} | ${record.jobId ?? ''} | ` +
        `${record.ok ? 'yes' : 'no'} | \`${detailBrief(record.detail, 60).replace(/\|/g, '\\|')}\` |`
    );
  }
  lines.push('', '## Summary by kind', '');
  lines.push('| action | count |');
  lines.push('| --- | --- |');
  for (const [kind, count] of Object.entries(report.countByAction)) {
    lines.push(`| ${kind} | ${count} |`);
  }
  if (report.aiCalls.length > 0) {
    lines.push('', '## AI calls', '');
    lines.push('| timestamp | model | in | out | cost usd | finish |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const call of report.aiCalls) {
      lines.push(
        `| ${call.ts} | ${call.model} | ${call.inputTokens} | ${call.outputTokens} | ` +
          `${call.costUsd.toFixed(4)} | ${call.finishReason} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Read the audit log and report.
 *
 * Order: existence gate (never create) → readonly open → query both tables →
 * `--to` filter → render or export. This command never mutates anything and
 * resolves ok with exit 0 on every successful read — even an empty one.
 */
export async function audit(
  opts: AuditOptions,
  deps: AuditDeps = {}
): Promise<Result<void, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const exists = deps.exists ?? existsSync;
  const storePath = opts.storePath ?? defaultStorePath();

  // A missing db is an EMPTY audit, not an error — and never a create.
  if (!exists(storePath)) {
    write('No audit log found (no state db) — nothing has been recorded yet.');
    return ok(undefined);
  }

  const opened = await (deps.openStateDb ?? defaultOpenStateDb)(storePath);
  if (opened.isErr()) return err(opened.error);
  const db = opened.value;

  const provenance = new ProvenanceAudit({ db });
  const recordsRead = await provenance.query({
    ...(opts.from !== undefined ? { since: opts.from } : {}),
    ...(opts.actor !== undefined ? { actor: opts.actor } : {}),
  });
  if (recordsRead.isErr()) return err(recordsRead.error);
  const records = withinTo(chronological(recordsRead.value), opts.to);

  // AI rows come from the `ai_calls` table (P-145), read through the same db.
  let aiCalls: AiCallAudit[] = [];
  if (opts.noAi !== true) {
    const ai = new AiAuditLog(db);
    aiCalls = await ai.query({
      ...(opts.from !== undefined ? { since: opts.from } : {}),
    });
    const to = opts.to;
    if (to !== undefined) aiCalls = aiCalls.filter(call => call.ts <= to);
  }

  // `lastMerge`/`lastChecksum` are OMITTED when absent — exactOptionalPropertyTypes.
  const lastMerge = [...records].reverse().find(record => record.action === 'merge');
  const lastChecksum = [...records].reverse().find(record => record.action === 'checksum');
  const report: AuditReport = {
    records,
    aiCalls,
    countByAction: countByKind(records),
    ...(lastMerge !== undefined ? { lastMerge } : {}),
    ...(lastChecksum !== undefined ? { lastChecksum } : {}),
  };

  if (opts.export === 'json') {
    write(JSON.stringify(report, null, 2));
    return ok(undefined);
  }
  if (opts.export === 'md') {
    write(auditMarkdown(report));
    return ok(undefined);
  }

  write(`Audit log (${storePath}):`);
  if (records.length === 0) {
    write('  (no matching provenance records)');
  }
  for (const record of records) {
    const line = formatRecord(record);
    const level = kindLevel(record.action);
    write(level === undefined ? line : theme(level, line));
  }
  if (opts.noAi !== true) {
    write(`AI calls: ${report.aiCalls.length}`);
    for (const call of report.aiCalls) write(`  ${formatAiCall(call)}`);
  }
  for (const line of summaryLines(report)) write(line);

  // `--follow`: tail for new records until the injected stop switch (or SIGINT)
  // ends the loop. Only the ids seen THIS session matter.
  if (opts.follow === true) {
    const everyMs = deps.everyMs ?? 2000;
    const sleep =
      deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const stop = deps.stop ?? (() => false);
    const seen = new Set(records.map(record => record.id));
    for (let iteration = 1; !stop(iteration); iteration += 1) {
      await sleep(everyMs);
      const next = await provenance.query(opts.actor === undefined ? {} : { actor: opts.actor });
      if (next.isErr()) return err(next.error);
      for (const record of chronological(next.value)) {
        if (!seen.has(record.id)) {
          seen.add(record.id);
          write(`+ ${formatRecord(record)}`);
        }
      }
    }
  }
  return ok(undefined);
}

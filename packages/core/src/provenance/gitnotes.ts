// P-184 — Provenance: git notes.
//
// Provenance should travel WITH the repository, not only in scratch storage. A
// `git notes` entry under `refs/notes/stitch-prov` attaches a structured record
// to the merge commit WITHOUT rewriting history, so the attribution a stitch
// produced is reviewable by ordinary git tooling and survives a clone.
//
// The note stays SMALL on purpose: it REFERENCES the SBOM (P-183) and carries a
// checksum of the provenance map, rather than inlining the map itself. A note is
// rewritten on every merge; a large one would be rewritten with it.
//
// Two details carry the design:
//
//   1. `git notes add` FAILS when a note already exists on that commit. That is
//      exactly why this module reads → merges → `add -f`, and it is why a second
//      write is a first-class test: the naive implementation silently drops the
//      previous note.
//   2. A note write is NON-BLOCKING. The primitive returns a `Result` so a caller
//      can act on it, and {@link attachProvenanceNote} degrades a failure to an
//      `onWarning` event — losing a note must not fail a stitch that otherwise
//      succeeded, but it must not be silent either.

import { err, ok, type Result } from 'neverthrow';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { type StitchError } from '../result/index.js';
import { SBOM_FILENAMES } from './sbom.js';
import { type ProvenanceMap } from './map.js';

const execFileAsync = promisify(execFile);

/** The namespace provenance notes live under (configurable per call). */
export const DEFAULT_NOTES_NAMESPACE = 'refs/notes/stitch-prov';

/** The note payload's schema version, so an old note can be recognised. */
export const PROVENANCE_NOTE_SCHEMA_VERSION = 1;

/** Default git timeout, matching the sibling git helpers. */
export const DEFAULT_NOTES_TIMEOUT_MS = 60_000;

/** What a provenance note carries (the phase's shape). */
export interface ProvenanceNote {
  schemaVersion: number;
  /** The SBOM filename this note points at — a reference, not the document. */
  provenanceRef: string;
  /** `sha256` of the map's sorted origins. */
  mapChecksum: string;
  generatedAt: string;
  statistics: { files: number; repos: number };
  /** Fragments may contribute more keys; none is ever dropped. */
  [key: string]: unknown;
}

/** A non-blocking note failure, for the audit trail (P-187). */
export interface ProvenanceNoteWarning {
  repoPath: string;
  commitRef: string;
  reason: 'write-failed' | 'read-failed';
  message: string;
}

/** Options for {@link writeGitNotes} / {@link attachProvenanceNote}. */
export interface GitNotesOptions {
  /** The notes namespace. Default {@link DEFAULT_NOTES_NAMESPACE}. */
  namespace?: string;
  /** Git timeout in ms. */
  timeoutMs?: number;
  /** Clock, injectable so a note is deterministic in tests. */
  now?: () => string;
}

/** Options for {@link attachProvenanceNote}. */
export interface AttachOptions extends GitNotesOptions {
  /** The SBOM filename to reference. Default P-183's CycloneDX name. */
  provenanceRef?: string;
  /** Receives a warning when the note could not be written. */
  onWarning?: (warning: ProvenanceNoteWarning) => void;
}

interface GitOut {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** Run git, converting a spawn rejection into data (never throws). */
async function gitRun(
  repoPath: string,
  args: readonly string[],
  timeoutMs: number
): Promise<GitOut> {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return { code: 0, stdout: stdout as Buffer, stderr: '' };
  } catch (error: unknown) {
    const e = error as { code?: unknown; stdout?: Buffer | string; stderr?: unknown };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: Buffer.from(e.stdout === undefined ? '' : (e.stdout as Buffer | string)),
      stderr: e.stderr === undefined ? String(error) : String(e.stderr),
    };
  }
}

/** `sha256` of the map's ORIGINS (already path-sorted, P-282). */
export function mapChecksum(map: ProvenanceMap): string {
  // `origins()` sorts by path, so identical content hashes identically. A `Map`
  // would hash insertion order instead, and two equal maps could disagree.
  return createHash('sha256').update(JSON.stringify(map.origins()), 'utf8').digest('hex');
}

/** Build the small note the phase specifies. */
export function buildProvenanceNote(map: ProvenanceMap, opts: AttachOptions = {}): ProvenanceNote {
  const origins = map.origins();
  const repos = new Set(origins.map(origin => origin.repo));
  const now = opts.now ?? (() => new Date().toISOString());
  return {
    schemaVersion: PROVENANCE_NOTE_SCHEMA_VERSION,
    provenanceRef: opts.provenanceRef ?? SBOM_FILENAMES.cyclonedx,
    mapChecksum: mapChecksum(map),
    // Derived from the inputs when possible, so a re-run of the same stitch is
    // deterministic (the P-182/P-183 precedent).
    generatedAt: origins[0]?.copiedAt ?? now(),
    statistics: { files: origins.length, repos: repos.size },
  };
}

/** Is this a plain object (a merge target rather than a scalar)? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge fragments without losing keys.
 *
 * A key present only in `existing` SURVIVES; on a conflicting scalar the new
 * value wins, so a re-run can refresh `generatedAt`. Nested objects merge
 * recursively for the same reason — an append must be additive.
 */
export function mergeNoteFragments(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key];
    merged[key] =
      isRecord(previous) && isRecord(value) ? mergeNoteFragments(previous, value) : value;
  }
  return merged;
}

const noteError = (message: string): StitchError => ({ code: 'GIT_ERROR', message });

/**
 * Attach a JSON note to a commit, MERGING with any note already there.
 *
 * `git notes add` refuses to overwrite, so the existing note is read first and
 * the fragments merged; the write is then forced. A missing note is the normal
 * first-write case, not a failure.
 */
export async function writeGitNotes(
  repoPath: string,
  commitRef: string,
  noteObj: Record<string, unknown>,
  opts: GitNotesOptions = {}
): Promise<Result<string, StitchError>> {
  if (repoPath.trim() === '' || commitRef.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'writeGitNotes: repoPath and commitRef are required',
    });
  }
  const namespace = opts.namespace ?? DEFAULT_NOTES_NAMESPACE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_NOTES_TIMEOUT_MS;

  const existing = await readGitNotes(repoPath, commitRef, namespace, timeoutMs);
  if (existing.isErr()) return err(existing.error);
  const merged = mergeNoteFragments(existing.value ?? {}, noteObj);
  const payload = JSON.stringify(merged);

  // `-f` because an existing note (just read) would otherwise make this fail.
  const written = await gitRun(
    repoPath,
    ['notes', `--ref=${namespace}`, 'add', '-f', '-m', payload, commitRef],
    timeoutMs
  );
  if (written.code !== 0) {
    return err(noteError(`writeGitNotes: git notes add failed: ${written.stderr.trim()}`));
  }
  return ok(payload);
}

/**
 * Read a commit's note as JSON.
 *
 * `ok(undefined)` means "no note", which is a normal state. A note that EXISTS
 * but is not a JSON object is an error: collapsing that into `undefined` would
 * hide a corrupt record from an audit.
 */
export async function readGitNotes(
  repoPath: string,
  commitRef: string,
  namespace: string = DEFAULT_NOTES_NAMESPACE,
  timeoutMs: number = DEFAULT_NOTES_TIMEOUT_MS
): Promise<Result<Record<string, unknown> | undefined, StitchError>> {
  const shown = await gitRun(
    repoPath,
    ['notes', `--ref=${namespace}`, 'show', commitRef],
    timeoutMs
  );
  if (shown.code !== 0) {
    // No note under this namespace is the documented "absent" case.
    return ok(undefined);
  }
  const text = shown.stdout.toString('utf8').trim();
  if (text === '') return ok(undefined);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return err(noteError(`readGitNotes: note on ${commitRef} is not a JSON object`));
    }
    return ok(parsed);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(noteError(`readGitNotes: note on ${commitRef} is not valid JSON: ${detail}`));
  }
}

/**
 * Enumerate every note in the namespace, keyed by commit.
 *
 * `git notes list` prints `<note blob sha> <annotated object sha>` per line; the
 * annotated object is what an audit (P-187) needs to key against.
 */
export async function fetchAllProvenanceNotes(
  repoPath: string,
  namespace: string = DEFAULT_NOTES_NAMESPACE,
  timeoutMs: number = DEFAULT_NOTES_TIMEOUT_MS
): Promise<Result<Record<string, Record<string, unknown>>, StitchError>> {
  const listed = await gitRun(repoPath, ['notes', `--ref=${namespace}`, 'list'], timeoutMs);
  if (listed.code !== 0) {
    return err(
      noteError(`fetchAllProvenanceNotes: git notes list failed: ${listed.stderr.trim()}`)
    );
  }
  const entries: Record<string, Record<string, unknown>> = {};
  for (const line of listed.stdout.toString('utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // `<note> <object>` — the annotated commit is the LAST field.
    const parts = trimmed.split(/\s+/);
    const objectSha = parts[parts.length - 1];
    if (objectSha === undefined || objectSha === '') continue;
    const note = await readGitNotes(repoPath, objectSha, namespace, timeoutMs);
    if (note.isErr()) return err(note.error);
    if (note.value !== undefined) entries[objectSha] = note.value;
  }
  return ok(entries);
}

/**
 * The NON-BLOCKING finalize path: build the note, write it, and degrade any
 * failure to a warning.
 *
 * Returns whether a note was written. Losing a note must not fail a stitch that
 * otherwise succeeded — but it is surfaced, so it cannot be lost silently.
 */
export async function attachProvenanceNote(
  map: ProvenanceMap,
  repoPath: string,
  commitRef: string,
  opts: AttachOptions = {}
): Promise<Result<boolean, StitchError>> {
  const note = buildProvenanceNote(map, opts);
  const written = await writeGitNotes(repoPath, commitRef, { ...note }, opts);
  if (written.isErr()) {
    opts.onWarning?.({
      repoPath,
      commitRef,
      reason: 'write-failed',
      // `message` may be absent on some variants; the code always exists.
      message: 'message' in written.error ? written.error.message : written.error.code,
    });
    return ok(false);
  }
  return ok(true);
}

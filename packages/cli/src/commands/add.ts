// P-191 — `stitch add <source> <paths...>`: record what to bring into the child.
//
// The command is pure ORCHESTRATION; every heavy edge is an injected port:
//
//   resolveSource  — a local dir as-is, or a shallow clone for `owner/repo` (P-069)
//   listFiles      — the source tree listing (P-103)
//   match          — the glob matcher (P-036)
//   load/saveSources — the project's `sources` array in the store (P-200)
//
// Nothing here re-implements cloning, matching or listing: the repo already has one
// canonical implementation of each, and a second one would drift. The ports also make
// all six mandated cases runnable without git, a network, the user's home directory or
// a config file.
//
// ON THE ERROR CODE: the phase's step 2 and its acceptance criteria both name
// `err('NO_PATHS_MATCH')`. That code does NOT exist in `StitchError` (grepping all of
// packages/core/src returns nothing), so "your patterns matched nothing" is reported as
// the existing `CONFIG_ERROR` carrying the patterns plus suggestions — the caller can
// fix it by naming different paths. Adding a code is a coordinated multi-file change
// (ADR-072 measured it), so it is recorded as a deviation rather than smuggled in.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import type { GlobalOptions } from '../globals.js';

/** One recorded source: what to take, from where, pinned to which ref. */
export interface SourceSelection {
  /** The source as the user typed it (a local path, or `owner/repo`). */
  source: string;
  /** Repo-relative, posix-separated paths or globs. */
  paths: string[];
  /** The pinned ref for a remote source (feeds P-181 provenance). Absent for local. */
  ref?: string;
}

/** What the command is given on top of the globals. */
export interface AddOptions extends GlobalOptions {
  /** `--branch` / `--ref`: pin a remote source to this ref. */
  branch?: string;
  /** `--allow-empty`: record a selection that matched nothing. */
  allowEmpty?: boolean;
}

/** Everything environmental, injected. All required: none of these is the CLI's job. */
export interface AddDeps {
  /** Local dir → itself; `owner/repo` → a shallow clone path. */
  resolveSource: (
    source: string,
    opts: { ref?: string; offline: boolean }
  ) => Promise<Result<string, StitchError>>;
  /** Repo-relative, posix-separated listing of the resolved source. */
  listFiles: (dir: string) => Promise<Result<string[], StitchError>>;
  /** Keep the files matching the patterns (P-036's matcher). */
  match: (patterns: readonly string[], files: readonly string[]) => string[];
  /** The project's current selections. */
  loadSources: () => Result<SourceSelection[], StitchError>;
  /** Persist the selections. */
  saveSources: (sources: SourceSelection[]) => Result<void, StitchError>;
  /** Where the human-readable output goes. */
  write?: (line: string) => void;
}

/** Is this an `owner/repo` reference rather than a path? */
export function looksRemote(source: string): boolean {
  // A path that exists on disk is never remote, and neither is one with a separator
  // that a GitHub slug cannot contain (`/a/b`, `./x`, `C:\x`).
  if (source.startsWith('.') || source.includes('\\') || source.split('/').length !== 2) {
    return false;
  }
  return /^[\w.-]+\/[\w.-]+$/.test(source) && !source.includes('.git/');
}

/** Does an existing selection already cover this source/ref and ALL these paths? */
function alreadyCovered(existing: readonly SourceSelection[], selection: SourceSelection): boolean {
  return existing.some(entry => {
    if (entry.source !== selection.source) return false;
    // A local entry and a pinned entry for the same source are different selections.
    if (entry.ref !== selection.ref) return false;
    return selection.paths.every(path => entry.paths.includes(path));
  });
}

/** Suggestions for a pattern that matched nothing: same basename, or the first few files. */
export function suggestionsFor(patterns: readonly string[], files: readonly string[]): string[] {
  const wanted = new Set(
    patterns.map(pattern => pattern.split('/').filter(Boolean).pop() ?? pattern)
  );
  const near = files.filter(file => {
    const name = file.split('/').filter(Boolean).pop() ?? file;
    return wanted.has(name);
  });
  return (near.length > 0 ? near : files).slice(0, 5);
}

/** The success summary: resolved repo, file count, and the next step. */
export function addSummary(selection: SourceSelection, fileCount: number): string[] {
  const pinned = selection.ref === undefined ? '' : ` @ ${selection.ref}`;
  return [
    `Added ${selection.source}${pinned} — ${fileCount} file${fileCount === 1 ? '' : 's'}`,
    'Next step:  stitch merge',
  ];
}

/**
 * Record a source selection.
 *
 * Order: resolve → list → match → refuse-or-dedupe → persist. Resolving and listing
 * BEFORE any store write is what makes a no-match refusal a pure read, leaving the
 * project config untouched.
 */
export async function add(
  opts: AddOptions,
  args: { source: string; paths: readonly string[] },
  deps: AddDeps
): Promise<Result<void, StitchError>> {
  const write = deps.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));

  if (args.source.trim() === '') {
    return err({ code: 'CONFIG_ERROR', field: 'source', message: 'add: a source is required' });
  }
  if (args.paths.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'paths',
      message: 'add: at least one path or glob is required',
    });
  }

  // `--offline` is local-only: a remote source needs the network by definition.
  if (opts.offline === true && looksRemote(args.source)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'source',
      message: `add: refused to clone "${args.source}" while --offline`,
    });
  }

  const resolved = await deps.resolveSource(args.source, {
    ...(opts.branch !== undefined ? { ref: opts.branch } : {}),
    offline: opts.offline === true,
  });
  if (resolved.isErr()) return err(resolved.error);

  const listed = await deps.listFiles(resolved.value);
  if (listed.isErr()) return err(listed.error);

  // Patterns are matched against the SOURCE-RELATIVE listing; a pattern that matches
  // nothing is a refusal (with suggestions) unless --allow-empty.
  const matched = [...new Set(deps.match(args.paths, listed.value))].sort();
  if (matched.length === 0 && opts.allowEmpty !== true) {
    const near = suggestionsFor(args.paths, listed.value);
    return err({
      code: 'CONFIG_ERROR',
      field: 'paths',
      message:
        `add: no files matched ${args.paths.join(', ')} in ${args.source}` +
        (near.length > 0 ? `; did you mean: ${near.join(', ')}?` : ''),
    });
  }

  const selection: SourceSelection = {
    source: args.source,
    paths: matched,
    ...(opts.branch !== undefined ? { ref: opts.branch } : {}),
  };

  const loaded = deps.loadSources();
  if (loaded.isErr()) return err(loaded.error);

  // Dedup is a WARNING, not an error: re-adding what is already recorded is a no-op.
  if (alreadyCovered(loaded.value, selection)) {
    write(`Already recorded: ${args.source} — no change`);
    return ok(undefined);
  }

  const saved = deps.saveSources([...loaded.value, selection]);
  if (saved.isErr()) return err(saved.error);

  for (const line of addSummary(selection, matched.length)) write(line);
  return ok(undefined);
}

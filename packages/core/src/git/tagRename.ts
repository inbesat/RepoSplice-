// Git tag namespacing (P-071): prefix repo tags (v1.2.3 → repo-a/v1.2.3)
// so merged children never collide on tag names (P-072) and provenance
// (P-079/181/182) can attribute tags per source.
//
// Safety contract (destructive-op discipline, P-070 rule):
// - Collision = target name taken in the PRE-rename listing (snapshot,
//   order-independent). Skipped olds stay under their old names and are
//   reported; blockers themselves are still renamed (relocated, never
//   destroyed). Nothing is ever overwritten: creation only targets names
//   absent from the snapshot, and `git tag` (no -f) refuses overwrites as
//   a backstop.
// - Deletion never precedes its replacement: per tag, create new, then
//   delete old. Worst case is duplication (visible, recoverable), never
//   loss.
// - New names pass `git check-ref-format` BEFORE anything mutates: an
//   invalid prefix fails the whole run with CONFIG_ERROR, zero renames.
// - Annotated tags stay annotated: rename moves the REF to the same tag
//   object (`git tag <new> <old>`), never re-creates the object.
// - All git invocations carry an explicit cwd (never ambient process cwd).
// - Ordering is lexicographic throughout (deterministic, P-282).
//   Version-aware sorting is P-080's job; this module documents the
//   lexicographic contract rather than guessing P-080's.

import { ok, err, type Result } from 'neverthrow';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StitchError } from '../result/index.js';
import { logger } from '../logger/index.js';

const execFileAsync = promisify(execFile);

/** Default git runner: explicit cwd, trimmed stdout, rejects on failure. */
async function defaultGitRun(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Runtime seam: git with explicit cwd (mirrors filterRepo's git seam). */
export interface TagRenameRuntime {
  git?: (args: readonly string[], cwd: string) => Promise<string>;
}

export interface RenameTagsOptions {
  /** Prefix prepended to every tag (e.g. 'repo-a/'). Must not be blank. */
  prefix: string;
}

/**
 * Rename outcome. `renamed` IS the old→new map the spec names (insertion
 * order = sorted tag order, deterministic); `skipped` holds olds whose
 * target was taken. Feeds the provenance map (P-079/181).
 */
export interface RenameTagsResult {
  renamed: Map<string, string>;
  skipped: string[];
}

function gitFailure(
  op: string,
  cause: unknown
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { code: 'GIT_ERROR', message: `${op} failed: ${detail}`, gitOutput: detail };
}

/**
 * List tag names, lexicographically sorted. Empty repo (no tags) is
 * ok([]) — not an error.
 */
export async function listTags(
  repoPath: string,
  runtime: TagRenameRuntime = {}
): Promise<Result<string[], StitchError>> {
  const git = runtime.git ?? defaultGitRun;
  let output: string;
  try {
    output = await git(['tag', '--list'], repoPath);
  } catch (cause: unknown) {
    return err(gitFailure('listTags', cause));
  }
  const tags = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  tags.sort();
  return ok(tags);
}

/**
 * Prefix-namespace every tag: old → prefix+old. Collisions (target taken
 * in the pre-rename listing) are skipped, never overwritten. Returns the
 * old→new map plus skips. See the header for the safety contract.
 */
export async function renameTags(
  repoPath: string,
  opts: RenameTagsOptions,
  runtime: TagRenameRuntime = {}
): Promise<Result<RenameTagsResult, StitchError>> {
  if (opts.prefix.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'prefix',
      message: 'renameTags: prefix must not be blank',
    });
  }
  const git = runtime.git ?? defaultGitRun;
  const log = logger.child({ op: 'tag-rename', repoPath, prefix: opts.prefix });

  const listed = await listTags(repoPath, runtime);
  if (listed.isErr()) return err(listed.error);
  const taken = new Set(listed.value);
  const renamed = new Map<string, string>();
  const skipped: string[] = [];

  // Plan against the snapshot: skips are order-independent.
  const pending: { oldName: string; newName: string }[] = [];
  for (const oldName of listed.value) {
    const newName = `${opts.prefix}${oldName}`;
    if (taken.has(newName)) {
      skipped.push(oldName);
    } else {
      pending.push({ oldName, newName });
    }
  }

  // Validate every new name before mutating anything.
  for (const { newName } of pending) {
    try {
      await git(['check-ref-format', `refs/tags/${newName}`], repoPath);
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.error({ err: detail }, 'renameTags rejected tag name');
      return err({
        code: 'CONFIG_ERROR',
        field: 'prefix',
        message: `renameTags: prefix produces invalid tag name ${JSON.stringify(newName)}`,
      });
    }
  }

  // Execute in sorted order: create replacement, then delete the old.
  // Creation targets are provably free (snapshot rule), so a failure here
  // is environmental (race, permissions) — reported with progress, and the
  // old tag is always still in place (duplication over loss).
  let completed = 0;
  for (const { oldName, newName } of pending) {
    try {
      await git(['tag', newName, oldName], repoPath);
    } catch (cause: unknown) {
      const failure = gitFailure(`renameTags ${oldName} → ${newName}`, cause);
      log.error({ err: failure.message, completed }, 'renameTags failed creating replacement');
      return err({
        ...failure,
        message: `${failure.message} (${completed} of ${pending.length} complete)`,
      });
    }
    try {
      await git(['tag', '-d', oldName], repoPath);
    } catch (cause: unknown) {
      const failure = gitFailure(`renameTags delete ${oldName}`, cause);
      log.error({ err: failure.message, completed }, 'renameTags failed deleting old tag');
      return err({
        ...failure,
        message: `${failure.message} (${completed} of ${pending.length} complete; replacement ${newName} exists)`,
      });
    }
    renamed.set(oldName, newName);
    completed += 1;
  }
  log.info({ renamed: renamed.size, skipped: skipped.length }, 'tag-rename complete');
  return ok({ renamed, skipped });
}

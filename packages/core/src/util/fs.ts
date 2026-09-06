// Win-safe staging filesystem helpers over `fs-extra` (P-035).
//
// Staging dirs, merged-tree writes (P-076/P-192), and fixture setup
// (P-062) all funnel through here so every path is traversal-checked.
// Every helper resolves its path arguments with P-012 `resolveWithin`
// against an explicit root FIRST — an escape (`..`, absolute path,
// symlink-hop out) returns err and NO filesystem call happens.
//
// NOTE on the spec text: it names `safeJoin`, but `safeJoin` THROWS on
// escape while this module must return `Result` per the P-011 contract
// and the AGENTS no-throw rule. `resolveWithin` is the exact
// Result-returning primitive `safeJoin` wraps, so using it directly
// satisfies the spec's intent (traversal prevention) without the throw.

import {
  copy as fsCopy,
  move as fsMove,
  ensureDir as fsEnsureDir,
  emptyDir as fsEmptyDir,
  remove as fsRemove,
  pathExists as fsPathExists,
} from 'fs-extra';
import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { resolveWithin } from './paths.js';

/** Resolve `parts` under `root`; err propagates untouched (already typed). */
function within(root: string, parts: readonly string[]): Result<string, StitchError> {
  const joined = parts.length === 0 ? root : [root, ...parts].join('/');
  return resolveWithin(root, joined);
}

/** Map an fs throw to a typed err with operation context. */
function fsError(cause: unknown, context: string): StitchError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return { code: 'INTERNAL', message: `${context}: ${detail}` };
}

/**
 * Ensure a directory exists (mkdir -p), resolved under `root`.
 * Returns ok(resolved path).
 */
export async function ensureDir(
  root: string,
  ...parts: string[]
): Promise<Result<string, StitchError>> {
  const resolved = within(root, parts);
  if (resolved.isErr()) return err(resolved.error);
  try {
    await fsEnsureDir(resolved.value);
    return ok(resolved.value);
  } catch (cause: unknown) {
    return err(fsError(cause, `ensureDir failed for ${resolved.value}`));
  }
}

/**
 * Ensure a directory exists and is empty (creates it if missing).
 * Returns ok(resolved path).
 */
export async function emptyDir(
  root: string,
  ...parts: string[]
): Promise<Result<string, StitchError>> {
  const resolved = within(root, parts);
  if (resolved.isErr()) return err(resolved.error);
  try {
    await fsEmptyDir(resolved.value);
    return ok(resolved.value);
  } catch (cause: unknown) {
    return err(fsError(cause, `emptyDir failed for ${resolved.value}`));
  }
}

/**
 * Remove a file or directory tree (no-op success when missing).
 * Returns ok(resolved path).
 */
export async function removePath(
  root: string,
  ...parts: string[]
): Promise<Result<string, StitchError>> {
  const resolved = within(root, parts);
  if (resolved.isErr()) return err(resolved.error);
  try {
    await fsRemove(resolved.value);
    return ok(resolved.value);
  } catch (cause: unknown) {
    return err(fsError(cause, `removePath failed for ${resolved.value}`));
  }
}

/**
 * Existence check, resolved under `root`. Escape → err (not false —
 * the caller must distinguish "absent" from "forbidden").
 */
export async function pathExists(
  root: string,
  ...parts: string[]
): Promise<Result<boolean, StitchError>> {
  const resolved = within(root, parts);
  if (resolved.isErr()) return err(resolved.error);
  try {
    return ok(await fsPathExists(resolved.value));
  } catch (cause: unknown) {
    return err(fsError(cause, `pathExists failed for ${resolved.value}`));
  }
}

/** Options for `copyTree` / `movePath`. */
export interface CopyMoveOptions {
  /** Overwrite an existing destination. Default: true (fs-extra default). */
  overwrite?: boolean;
}

/**
 * Copy a file or tree from `srcRoot/srcRel` to `destRoot/destRel`.
 * Both sides resolve independently (source repos live outside the
 * staging root). Returns ok(resolved dest path).
 *
 * With `overwrite: false`, an existing destination is a typed err —
 * checked up front (fs-extra version semantics for no-overwrite
 * copies differ; the wrapper contract does not).
 */
export async function copyTree(
  srcRoot: string,
  srcRel: string,
  destRoot: string,
  destRel: string,
  options: CopyMoveOptions = {}
): Promise<Result<string, StitchError>> {
  const src = within(srcRoot, [srcRel]);
  if (src.isErr()) return err(src.error);
  const dest = within(destRoot, [destRel]);
  if (dest.isErr()) return err(dest.error);
  if (options.overwrite === false) {
    let exists: boolean;
    try {
      exists = await fsPathExists(dest.value);
    } catch (cause: unknown) {
      return err(fsError(cause, `copyTree exists-check failed for ${dest.value}`));
    }
    if (exists) {
      return err({
        code: 'INTERNAL',
        message: `copyTree destination exists (overwrite:false): ${dest.value}`,
      });
    }
  }
  try {
    await fsCopy(src.value, dest.value, options.overwrite === false ? { overwrite: false } : {});
    return ok(dest.value);
  } catch (cause: unknown) {
    return err(fsError(cause, `copyTree failed ${src.value} -> ${dest.value}`));
  }
}

/**
 * Move a file or tree from `srcRoot/srcRel` to `destRoot/destRel`.
 * Same `overwrite: false` guard as `copyTree`. Returns ok(resolved
 * dest path).
 */
export async function movePath(
  srcRoot: string,
  srcRel: string,
  destRoot: string,
  destRel: string,
  options: CopyMoveOptions = {}
): Promise<Result<string, StitchError>> {
  const src = within(srcRoot, [srcRel]);
  if (src.isErr()) return err(src.error);
  const dest = within(destRoot, [destRel]);
  if (dest.isErr()) return err(dest.error);
  if (options.overwrite === false) {
    let exists: boolean;
    try {
      exists = await fsPathExists(dest.value);
    } catch (cause: unknown) {
      return err(fsError(cause, `movePath exists-check failed for ${dest.value}`));
    }
    if (exists) {
      return err({
        code: 'INTERNAL',
        message: `movePath destination exists (overwrite:false): ${dest.value}`,
      });
    }
  }
  try {
    await fsMove(src.value, dest.value, options.overwrite === false ? { overwrite: false } : {});
    return ok(dest.value);
  } catch (cause: unknown) {
    return err(fsError(cause, `movePath failed ${src.value} -> ${dest.value}`));
  }
}

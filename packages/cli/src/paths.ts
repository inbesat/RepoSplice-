// P-205 — `paths.ts`: file/naming conventions + the path-guard validators.
//
// This is the CLI's ONE place for generated names and safe paths: `validateName`
// (the `^[a-z][a-z0-9-_]*$` convention), `slugify` (deterministic, deduped), and
// `safeJoin` (traversal/absolute/containment refusal), plus `defaultOutDir` and
// the global write deny-list. Every place a name or path is created is supposed
// to reuse these rather than improvise a regex.
//
// ON THE ERROR CODE: the phase names `err('INVALID_NAME', name, reason)`; that
// code does NOT exist in `StitchError` (grepped — and adding one is the
// coordinated core change ADR-072 measured). `validateName` is therefore a pure
// boolean predicate (the phase allows "returns boolean"), and the Result-bearing
// validators (`safeJoin`) report `CONFIG_ERROR` with the offending part named —
// the P-239/P-246 phantom-code pattern, recorded in ADR-090.
//
// ON REALPATH: the spec's containment check mentions `realpath`. That touches
// the filesystem (symlinks resolve at CALL time), which a named-guard cannot do
// deterministically before the caller has created anything; `safeJoin` therefore
// checks containment LEXICALLY (resolve + prefix). Core's sandbox (P-175) stays
// the authority on what the OS actually allows at write time.

import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';

/** The name convention (P-205): lowercase-first, then letters/digits/`-`/`_`. */
const NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Windows reserved device names (case-insensitive; a `con.txt` is reserved
 * too, so the check runs on the segment before the first dot).
 */
const RESERVED: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** The cap a slug is trimmed to (the phase's "default 64"). */
export const MAX_SLUG_LENGTH = 64;

/**
 * The name convention. Rejects anything not matching `^[a-z][a-z0-9-_]*$`,
 * Windows reserved device names (any case, before any extension), and control
 * characters. Pure: returns a verdict, never throws.
 */
export function validateName(name: string): boolean {
  if (NAME_RE.test(name) === false) return false;
  const base = parse(name).name.toLowerCase();
  if (RESERVED.has(base)) return false;
  return true;
}

/**
 * Deterministic slug: lowercase, ASCII-fold (NFD + strip combining marks),
 * runs of non-alphanumerics → `-`, trimmed, never longer than
 * {@link MAX_SLUG_LENGTH}, always starting with a letter (`s-` prefix when the
 * fold leaves a digit or nothing). With a `used` set, a collision is numbered
 * (`-2`, `-3`, …) and the RESULT is recorded INTO the set, so a caller can keep
 * calling without bookkeeping.
 */
export function slugify(name: string, used?: Set<string>): string {
  const folded = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  const slug = /^[a-z]/.test(folded) ? folded : `s-${folded}`;
  if (used === undefined) return slug;
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  // Number the collision -2, -3, …, re-trimming the length cap for the suffix.
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${slug
      .slice(0, Math.max(1, MAX_SLUG_LENGTH - suffix.length))
      .replace(/-+$/g, '')}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// `no-control-regex` forbids literal control characters in regexes; the CSI
// class is therefore built from code points (the house pattern since P-202).
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`
);

/**
 * Join path parts under `base`, refusing anything unsafe BEFORE touching the
 * filesystem: absolute parts, drive-qualified parts (`C:`), `..` segments, and
 * control characters each name the offending part in a `CONFIG_ERROR`; the
 * resolved result is then verified LEXICALLY to stay inside `base` (the
 * containment check — see the realpath note above).
 */
export function safeJoin(base: string, ...parts: readonly string[]): Result<string, StitchError> {
  for (const part of parts) {
    const bad =
      part.length > 0 &&
      (isAbsolute(part) ||
        /^[a-zA-Z]:/.test(part) ||
        part.split(/[\\/]+/).includes('..') ||
        CONTROL_CHARS.test(part));
    if (bad) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'safeJoin',
        message: `path part is not safeJoin-clean: ${JSON.stringify(part)}`,
      });
    }
  }
  const resolvedBase = resolve(base);
  const joined = resolve(resolvedBase, ...parts);
  if (joined !== resolvedBase && !joined.startsWith(resolvedBase + sep)) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'safeJoin',
      message: `path escapes the base directory: ${JSON.stringify(joined)}`,
    });
  }
  return ok(joined);
}

/**
 * The global write deny-list (P-205 step 3): paths that never belong to a
 * project write, to fence rogue generated/agent output. Absolute system roots
 * plus the home `.ssh` directory. Compared on the RESOLVED target, case- and
 * separator-normalized so one list works on both platforms.
 */
const WRITE_DENY_LIST: readonly string[] = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  'C:\\Windows',
  'C:\\Program Files',
  join(homedir(), '.ssh'), // the home-config fence (the ~ expansion resolves for it)
];

/** True when `target` is inside (or is) a denied root. */
export function isDeniedWritePath(target: string): boolean {
  const normalize = (value: string): string =>
    resolve(
      value === '~' || value.startsWith('~/') || value.startsWith(`~${sep}`)
        ? join(homedir(), value.slice(1))
        : value
    )
      .toLowerCase()
      .replace(/[\\/]+/g, '/');
  const normalized = normalize(target);
  return WRITE_DENY_LIST.some(root => {
    const denied = normalize(root);
    return normalized === denied || normalized.startsWith(`${denied}/`);
  });
}

/** The default child directory, relative to the working dir. */
export const DEFAULT_OUT_DIR = 'stitch-out';

/** `<cwd>/stitch-out` — what `stitch merge` uses absent `--out` (P-192). Resolved so the value is absolute-ready. */
export function defaultOutDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), DEFAULT_OUT_DIR);
}

// P-203 — the single error/exit entrypoint: the full exit-code map, the
// `✘ code + message + hint + next-step` renderer, and the ExitError carrier.
//
// Three deliberate properties:
//
//   1. THE EXIT MAP IS DATA. `EXIT_BY_CODE` is one static table over
//      `StitchErrorCode` (per the handoff note: "keep hints data-driven from a
//      static table"), so renumbering or translating never touches logic.
//      Anything not in the table is a plain known error (1); anything that is
//      not a StitchError at all is internal (70).
//   2. RENDERING IS ONE WRITE. `printStitchError` returns a single string with
//      embedded newlines — callers issue ONE write, so log interleave cannot
//      split a code line from its hint, and existing single-line pins hold.
//   3. COLOR IS OPTIONAL BY CONSTRUCTION. The header line paints through the
//      P-202 theme (`--no-color`/NO_COLOR → plain) and every line reads
//      correctly stripped.

import { friendlyError, type StitchError, type StitchErrorCode } from '@repo-stitcher/core';
import { theme } from './theme.js';

/**
 * Process-wide diagnostic switches, installed by cli.ts's preAction hook from
 * the `--trace`/`-V` globals — the P-202 `applyColorMode` pattern: a
 * zero-argument render helper (`exitCodeForResult`) needs the flag without
 * every call site threading it. Tests reset via {@link resetDiagnostics}.
 */
let traceFromFlag = false;
let verboseFromFlag = false;

/** Install the `--trace`/`--verbose` switches for this process (sticky). */
export function setDiagnostics(trace: boolean, verbose: boolean): void {
  traceFromFlag = trace;
  verboseFromFlag = verbose;
}

/** Clear the diagnostic switches (test seam). */
export function resetDiagnostics(): void {
  traceFromFlag = false;
  verboseFromFlag = false;
}

/** The full exit-code contract (documented in `stitch --help` via cli.ts). */
export const ExitCode = {
  /** Success. */
  OK: 0,
  /** A general/known error without a more specific class. */
  ERROR: 1,
  /** The invocation itself was wrong (commander usage faults). */
  USAGE: 2,
  /** The project config is invalid or unloadable (P-200). */
  CONFIG: 3,
  /** A path/selection problem (missing files, nothing recorded). */
  PATH: 4,
  /** A human-in-the-loop gate aborted the run (P-160 / the P-198 pickers). */
  HIL: 10,
  /** License/compliance posture denied the merge (P-120/P-196). */
  LICENSE: 20,
  /** The sandbox backend is unavailable (P-168). */
  SANDBOX: 30,
  /** An AI provider failed (auth, model, budget, failover exhausted). */
  AI: 40,
  /** Dependencies conflict and no resolution was applied (P-197). */
  DEPS: 50,
  /** Internal error — report with `--trace` output. */
  INTERNAL: 70,
} as const;

/** The exit codes as a type (const-object enum; no runtime TS enum). */
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * StitchErrorCode → exit code. Deliberately SPARSE: only the classes P-203's
 * map names. Everything unlisted → `ExitCode.ERROR` (1), the general class.
 */
const EXIT_BY_CODE: Partial<Record<StitchErrorCode, ExitCode>> = {
  // 3 — config invalid (P-200's loader and its loader-adjacent faults)
  CONFIG_ERROR: ExitCode.CONFIG,
  CONFIG_INVALID: ExitCode.CONFIG,
  // 4 — path/selection problems
  SELECT_PATH_NOT_FOUND: ExitCode.PATH,
  FILE_NOT_FOUND: ExitCode.PATH,
  // 10 — a human (or a surface speaking for one) aborted the run
  ABORTED: ExitCode.HIL,
  USER_CANCELLED: ExitCode.HIL,
  SANDBOX_ABORTED: ExitCode.HIL,
  // 20 — the merge is denied by license/compliance posture
  LICENSE_VIOLATION: ExitCode.LICENSE,
  COMPLIANCE_VIOLATION: ExitCode.LICENSE,
  // 30 — the sandbox backend is not there
  SANDBOX_UNAVAILABLE: ExitCode.SANDBOX,
  // 40 — the AI subsystem failed to answer
  AI_PROVIDER_ERROR: ExitCode.AI,
  AUTH_ERROR: ExitCode.AI,
  INVALID_PROVIDER: ExitCode.AI,
  UNKNOWN_MODEL: ExitCode.AI,
  NO_FAILOVER: ExitCode.AI,
  // 50 — deps unresolvable without a human decision
  DEPENDENCY_CONFLICT: ExitCode.DEPS,
  // 70 — internal
  INTERNAL: ExitCode.INTERNAL,
};

/**
 * exitFor: the ONE mapping every command's failure goes through. Shape-safe —
 * a non-object, a code-less object, or a code the union doesn't carry all
 * land on internal (70) / general (1) without throwing.
 */
export function exitFor(e: unknown): ExitCode {
  if (e === null || typeof e !== 'object' || !('code' in e)) return ExitCode.INTERNAL;
  const code = (e as { code: unknown }).code;
  if (typeof code !== 'string') return ExitCode.INTERNAL;
  if (code === 'LICENSE_VIOLATION') {
    const policy = (e as { policy?: unknown }).policy;
    // a WARN verdict is a note, not a denial — general error, not 20
    return policy === 'deny' ? ExitCode.LICENSE : ExitCode.ERROR;
  }
  const mapped = EXIT_BY_CODE[code as StitchErrorCode];
  return mapped ?? ExitCode.ERROR;
}

/**
 * toHuman: the actionable next step per error code (the spec's examples:
 * license → "run stitch license"). Data-driven; a code with no entry gets the
 * generic suggestion. Kept separate from core's `hint` (WHY it failed) — this
 * table answers WHAT to do next, so it stays translatable on its own.
 */
const NEXT_STEPS: Partial<Record<StitchErrorCode, string>> = {
  CONFIG_ERROR: 'run `stitch config` to inspect the resolved config; `--edit` to fix it',
  CONFIG_INVALID: 'run `stitch config --edit` to fix the filed issues',
  SELECT_PATH_NOT_FOUND: 'run `stitch add <repo> <paths>` to record paths that exist',
  FILE_NOT_FOUND: 're-check the path spelling; `stitch status` shows recorded sources',
  ABORTED: 'review pending gates with `stitch status`, then re-run',
  USER_CANCELLED: 're-run the command and answer the prompt to continue',
  SANDBOX_ABORTED: 'inspect the build output, then re-run to retry the sandbox stage',
  LICENSE_VIOLATION: 'run `stitch license --allow <id>` to record a decision',
  COMPLIANCE_VIOLATION: 'review the failing rule, then adjust the license policy config',
  SANDBOX_UNAVAILABLE: 'check Docker (`stitch doctor`) or configure the github-actions backend',
  AI_PROVIDER_ERROR: 'check the provider key with `stitch doctor`; verify the model name',
  AUTH_ERROR: 'check the provider key with `stitch doctor`',
  INVALID_PROVIDER:
    'pick a configured provider in the config (`openrouter`, `anthropic`, `ollama`)',
  UNKNOWN_MODEL: 'pick a model the provider knows; `stitch doctor` shows provider health',
  NO_FAILOVER: 'add a fallback provider in the config, or fix the primary',
  DEPENDENCY_CONFLICT: 'run `stitch deps --auto` to apply the resolver suggestions',
  INTERNAL: 're-run once with `--trace`; if it persists, file an issue with that output',
};

/** The next-step suggestion for an error, or `null` when none is known. */
export function toHuman(e: StitchError): string | null {
  return NEXT_STEPS[e.code] ?? null;
}

/**
 * describeError: one line of WHAT happened, from whichever field the union
 * member carries. Union members without `message` get a small per-code phrase
 * rather than a bare code dump.
 */
function describeError(e: StitchError): string {
  const message = (e as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim() !== '') return message;
  // `details` is the carrier on conflict-shaped members (DEPENDENCY_CONFLICT)
  const details = (e as { details?: unknown }).details;
  if (typeof details === 'string' && details.trim() !== '') return details;
  if (e.code === 'LICENSE_VIOLATION') return `license ${e.license} violates the ${e.policy} policy`;
  if (e.code === 'UNKNOWN_LICENSE') return `unknown license id "${e.id}"`;
  return e.code;
}

/** The stack to show under `--trace`, or null for a typed (stackless) error. */
function errorStack(e: unknown): string | null {
  if (e instanceof Error && e.stack !== undefined) return e.stack;
  if (e !== null && typeof e === 'object' && 'cause' in e) {
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.stack !== undefined) return cause.stack;
  }
  return null;
}

/**
 * printStitchError: the ONE renderer every command's failure goes through.
 *
 * ```text
 * ✘ CONFIG_INVALID: 2 issues in stitch.toml
 *   ↳ The resolved per-job config failed validation; the error lists every
 *     offending field … (the P-163 hint via core's friendlyError)
 *   next: run `stitch config --edit` to fix the filed issues
 * ```
 *
 * `verbose`/`--trace` appends the stack when one exists (INTERNAL's `cause`,
 * a thrown Error), or an explicit "typed error has no stack" line so silence
 * is never ambiguous. The error's own fields are included under `--trace` so
 * a bug report carries the full shape.
 */
export function printStitchError(
  e: unknown,
  opts: { trace?: boolean; verbose?: boolean } = {}
): string {
  const trace = opts.trace ?? traceFromFlag;
  const verbose = opts.verbose ?? verboseFromFlag;
  const isStitch =
    e !== null &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string';
  const code = isStitch ? ((e as { code: string }).code as StitchErrorCode) : 'INTERNAL';
  const described = isStitch
    ? describeError(e as StitchError)
    : e instanceof Error
      ? e.message
      : String(e);
  const lines: string[] = [theme('err', `✘ ${code}: ${described}`)];
  if (isStitch) {
    lines.push(`  ↳ ${friendlyError(e as StitchError)}`);
    const next = toHuman(e as StitchError);
    if (next !== null) lines.push(`  next: ${next}`);
  }
  if (trace === true || verbose === true) {
    const stack = errorStack(e);
    if (stack !== null) {
      lines.push('  trace:');
      for (const line of stack.split('\n')) lines.push(`  ${line}`);
    } else {
      lines.push('  trace: (typed error — no stack attached)');
    }
    if (trace === true && isStitch) {
      lines.push(`  error-json: ${JSON.stringify(e)}`);
    }
  }
  return lines.join('\n');
}

/**
 * ExitError: the carrier for an exit decision that must cross a throw-based
 * boundary (commander's exitOverride path), converted back to a return code
 * in `main`'s catch. Nothing else in the CLI throws; this exists so the
 * boundary stays typed instead of smuggling a number through a bare Error.
 */
export class ExitError extends Error {
  constructor(
    readonly exitCode: ExitCode,
    message: string
  ) {
    super(message);
    this.name = 'ExitError';
  }
}

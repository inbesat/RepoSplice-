// P-158 — tool args and tool-result validation.
//
// A tool's arguments come from a model, and a tool's result flows straight back
// into the model's context. Both directions are untrusted, and both have failed
// in ways that corrupt the loop rather than failing loudly:
//
//   1. PROTOTYPE POLLUTION. A model can emit `{"__proto__": {...}}` in a tool
//      call. JSON.parse produces that as an OWN property, so a later spread or
//      Object.assign copies it onto a real object and mutates
//      `Object.prototype` for the whole process. This module rejects such keys
//      anywhere in the tree, at any depth, before the value reaches a tool.
//      The denylist is deliberately P-152's (`__proto__`, `prototype`,
//      `constructor`) rather than the spec's two: assigning `constructor` is
//      the same class of attack, and one denylist for the codebase is worth
//      more than matching a sketch.
//
//   2. PATH TRAVERSAL. `path`-shaped arguments arrive from a model that has
//      been told to fix a file. `../../.ssh/authorized_keys` is a legitimate
//      string as far as JSON is concerned. Only fields that genuinely name a
//      repository path are checked (STRICT_PATH_SAFE); a field called
//      `description` is never mistaken for a path, because a traversal check
//      applied to prose is a false-positive generator.
//
//   3. UNBOUNDED NESTING. Recursion is the only way to check (1) and (2) at
//      arbitrary depth, and unbounded recursion on model-controlled data is a
//      stack-overflow crash. MAX_TOOL_ARGS_DEPTH bounds the walk, and the
//      depth check is part of the same traversal so it can never be skipped.
//
//   4. OVERSIZED RESULTS. A tool that returns a megabyte of diff text does not
//      fail — it succeeds, and then the next model call fails or gets
//      truncated by the provider. The size is checked BEFORE the value is
//      handed back, so the loop reports the problem instead of silently
//      corrupting its own context.
//
// NOT A SCHEMA VALIDATOR. Argument shape is P-139's `parseToolArgs`, which the
// loop already calls; this module runs alongside it and adds the checks a Zod
// schema cannot express (it has no notion of a hostile `__proto__` key, and no
// way to bound serialized size). Keeping the two separate means each has one
// job: P-139 answers "are these the right shape?", this answers "are these
// safe to act on?".

import { ok, err, type Result } from 'neverthrow';
import { parseToolArgs } from '../ai/toolAdapter.js';
import type { ToolDefinition, ToolValidator } from '../ai/types.js';
import { type AiAuditLog } from '../ai/audit.js';
import { type StitchError } from '../result/index.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Maximum serialized size of one tool result, in bytes (1MB).
 *
 * Configurable through the P-009 `[agent]` block
 * (`maxToolResultBytes`) so a large-repo tool can raise it deliberately rather
 * than having its output silently truncated.
 */
export const MAX_TOOL_RESULT_BYTES = 1_000_000;

/**
 * Maximum nesting depth of one tool's arguments (spec: "e.g. 16").
 *
 * Real tool arguments are two or three levels deep. A bound of 16 leaves ample
 * headroom while keeping the recursive walk well inside the JS stack.
 */
export const MAX_TOOL_ARGS_DEPTH = 16;

/** Keys that must never appear at any depth in a tool's arguments. */
export const FORBIDDEN_ARG_KEYS: readonly string[] = ['__proto__', 'prototype', 'constructor'];

/**
 * Argument field names that are checked for path traversal.
 *
 * An allowlist, not a denylist: a new tool that adds a `dir` field gets
 * checked, whereas a denylist would silently skip any field nobody thought of.
 * The cost is that a *new* path-shaped field is checked by default only if it
 * is added here, which is the right trade — a false negative is a traversal.
 */
export const STRICT_PATH_SAFE: readonly string[] = [
  'path',
  'paths',
  'file',
  'files',
  'filePath',
  'file_path',
  'from',
  'to',
  'source',
  'target',
  'dir',
  'directory',
  'root',
  'key',
  'testPath',
  'configPath',
  'outputPath',
];

/** Which side of `execute` a rejection came from. */
export type ValidationStage = 'args' | 'result';

/** Which check rejected the value. */
export type ValidationKind =
  'proto_pollution' | 'path_traversal' | 'depth_exceeded' | 'too_large' | 'invalid_json';

/** Limits for one validation pass. Both fields fall back to the constants. */
export interface ValidationLimits {
  maxResultBytes?: number;
  maxArgsDepth?: number;
}

/** Where a validation failure happened, for the audit trail (P-145). */
export interface ValidationFailureDetail {
  stage: ValidationStage;
  kind: ValidationKind;
  tool: string;
  /** The human-readable justification, redacted before it is stored. */
  reason: string;
  location?: string;
  size?: number;
  max?: number;
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

/**
 * True only for a bare object literal.
 *
 * Arrays, class instances, `null`, and anything with a null prototype are
 * excluded: a null-prototype object is already inert with respect to
 * `__proto__`, and a class instance's inherited members are not attacker data.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Own enumerable keys only.
 *
 * `Object.keys` rather than `for...in`, so a `__proto__` payload cannot smuggle
 * an inherited `Object.prototype` member into the walk as if it were data.
 */
function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_ARG_KEYS.includes(key);
}

/**
 * Does this path segment escape the repository root?
 *
 * A single-segment `..` at the start escapes; a later `..` merely cancels the
 * segment before it and stays inside. That distinction matters: `a/../b` is a
 * legitimate way to write `b` and rejecting it would break real callers, while
 * `../b` must not be accepted.
 *
 * Also treats an absolute path (POSIX `/x` or Windows `C:\x`) as escaping,
 * because a repo-relative field has no legitimate absolute value, and rejects
 * backslash-separated traversal so a Windows-authored model cannot slip
 * `..\..\` past a forward-slash-only check.
 */
function escapesRoot(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.length === 0) return false;
  if (normalized.startsWith('/')) return true;
  // Windows drive-qualified absolute path.
  if (/^[A-Za-z]:\//.test(normalized)) return true;
  let depth = 0;
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (depth === 0) return true;
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return false;
}

/** Is this field name one the traversal check applies to? */
function isPathField(name: string): boolean {
  return STRICT_PATH_SAFE.includes(name);
}

/**
 * The first value in a path field that escapes the root, or `undefined`.
 *
 * Accepts a bare string or an array of strings, because the path-looking fields
 * in {@link STRICT_PATH_SAFE} are used both ways (`path` is one path, `paths`
 * and `files` are lists). A non-string element is ignored rather than
 * rejected: the Zod schema is the authority on a field's type, and this check
 * is only about what a well-typed value *contains*.
 */
function findEscapingPath(value: unknown): string | undefined {
  if (typeof value === 'string') return escapesRoot(value) ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  for (const element of value) {
    if (typeof element === 'string' && escapesRoot(element)) return element;
  }
  return undefined;
}

/**
 * Build the `err` half for an argument-side validation rejection.
 *
 * `TOOL_ARGS_VALIDATION` is the existing code for "these arguments did not
 * pass validation", which is exactly what a proto-polluting key, a traversal,
 * and a depth violation are. The distinguishing detail travels in the message
 * (and is recovered by {@link classifyRejection} for the audit `kind`), so the
 * four arg-side checks stay one code with four diagnosable messages rather than
 * four near-identical codes.
 */
function reject(message: string): Result<never, StitchError> {
  return err({ code: 'TOOL_ARGS_VALIDATION', message });
}

// ---------------------------------------------------------------------------
// Args validation
// ---------------------------------------------------------------------------

/**
 * Recursively check an argument tree for hostile keys, traversal, and depth.
 *
 * Iterative rather than recursive-by-assertion: an explicit stack cannot be
 * defeated by a cycle, and the depth counter is carried alongside each frame so
 * the bound is checked on the way *down* — a value nested past the limit is
 * rejected without ever being descended into.
 */
function scanArgs(tool: string, raw: unknown, maxDepth: number): Result<true, StitchError> {
  // Each frame is [value, depth, keyPath]. A null-prototype object is used so a
  // `__proto__` key on the *stack frame* could never be inherited either.
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value: raw, depth: 0, path: '' },
  ];
  // A cycle would otherwise loop forever; a bounded visit set makes each node
  // examined once, which is sufficient because the checks are per-node.
  const seen = new Set<object>();

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { value, depth, path } = frame;

    if (value === null || typeof value !== 'object') continue;

    if (seen.has(value)) continue;
    seen.add(value);

    if (depth > maxDepth) {
      return reject(
        `Tool "${tool}" arguments nest deeper than the ${maxDepth}-level limit at ` +
          `"${path || '(root)'}"`
      );
    }

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        stack.push({ value: value[i], depth: depth + 1, path: `${path}[${i}]` });
      }
      continue;
    }

    if (!isPlainObject(value)) continue;

    for (const key of ownKeys(value)) {
      const childPath = path.length > 0 ? `${path}.${key}` : key;

      if (isForbiddenKey(key)) {
        return reject(
          `Tool "${tool}" arguments contain the prototype-polluting key ` +
            `"${key}" at "${childPath}"`
        );
      }

      const child: unknown = value[key];

      // A path field can hold a single path or a list of them (`paths`,
      // `files`). Checking only the string case would let a traversal through
      // the moment a tool grew an array argument, so both shapes are resolved.
      if (isPathField(key)) {
        const offending = findEscapingPath(child);
        if (offending !== undefined) {
          return reject(
            `Tool "${tool}" argument "${childPath}" escapes the repository root: "${offending}"`
          );
        }
      }

      stack.push({ value: child, depth: depth + 1, path: childPath });
    }
  }
  return ok(true);
}

/**
 * Validate a tool call's arguments before `execute`.
 *
 * Two independent checks, in this order:
 *
 *   1. The hostile-input scan ({@link scanArgs}) — proto-polluting keys, `..`
 *      traversal in path fields, and the depth bound. This runs on the RAW
 *      value, before any parsing, because the danger is in the keys and the
 *      scan must see them as the model wrote them.
 *   2. P-139's `parseToolArgs` — shape, required fields, and types. Its
 *      failures (`TOOL_ARGS_INVALID_JSON`, `TOOL_ARGS_VALIDATION`) pass through
 *      untouched so the loop and the model see exactly what they saw before
 *      P-158.
 *
 * A hostile input is rejected rather than "sanitized": dropping the offending
 * key would silently change what the tool was asked to do, and a model that
 * meant to write `src/index.ts` would get a confusing tool error instead of a
 * clear rejection. The loop turns the rejection into a tool result, so the
 * model can correct itself.
 *
 * @param tool - The tool the call is for; used only for messages and auditing
 * @param args - Raw arguments as the provider supplied them
 * @param schema - P-139 field-to-Zod schema
 * @param limits - Optional bound overrides from the `[agent]` config block
 * @returns The validated arguments, or the first `StitchError` found
 */
export function sanitizeToolArgs<T extends Record<string, unknown>>(
  tool: ToolDefinition,
  args: unknown,
  limits: ValidationLimits = {}
): Result<T, StitchError> {
  const maxDepth = limits.maxArgsDepth ?? MAX_TOOL_ARGS_DEPTH;
  const scanned = scanArgs(tool.name, args, maxDepth);
  // Re-wrapped rather than returned: `Result<true, E>` is not assignable to
  // `Result<T, E>` because the ok type is invariant.
  if (scanned.isErr()) return err(scanned.error);
  return parseToolArgs<T>(tool.schema, args);
}

// ---------------------------------------------------------------------------
// Result validation
// ---------------------------------------------------------------------------

/**
 * Serialized size of a value, or `undefined` when it cannot be serialized.
 *
 * `JSON.stringify` throws on a circular structure and on a BigInt. A tool that
 * returns either is broken, and a validator that throws would take the loop
 * down with it, so the failure is reported rather than propagated.
 */
function serializedSize(value: unknown): { size: number } | { tooDeep: true } {
  try {
    const text = JSON.stringify(value ?? null);
    return { size: text === undefined ? 0 : text.length };
  } catch {
    return { tooDeep: true };
  }
}

/**
 * Validate a tool's result before the loop hands it back to the model.
 *
 * `err` results pass through **unchanged** — by identity, not by re-wrapping —
 * because a tool that failed has already produced the right error, and the loop
 * must not be able to turn a `GIT_ERROR` into a `TOOL_RESULT_TOO_LARGE`. This
 * is the spec's first acceptance criterion and the reason the function is
 * ordered err-first rather than checking size before the variant.
 *
 * An `ok` result is measured as JSON, which is the form the loop actually puts
 * in front of the model. Measuring anything else (a byte count of the object in
 * memory) would not bound the context window the way this is meant to.
 *
 * @param tool - The tool that produced the result; used for messages and auditing
 * @param result - The tool's raw return value
 * @param limits - Optional bound overrides from the `[agent]` config block
 * @returns The result, or `TOOL_RESULT_TOO_LARGE` carrying the size and the limit
 */
export function validateToolResult<T>(
  tool: ToolDefinition,
  result: Result<unknown, StitchError>,
  limits: ValidationLimits = {}
): Result<T, StitchError> {
  if (result.isErr()) return err(result.error);
  const max = limits.maxResultBytes ?? MAX_TOOL_RESULT_BYTES;
  const measured = serializedSize(result.value);
  if ('tooDeep' in measured) {
    return reject(`Tool "${tool.name}" returned a value that cannot be serialized to JSON`);
  }
  if (measured.size > max) {
    return err({
      code: 'TOOL_RESULT_TOO_LARGE',
      message:
        `Tool "${tool.name}" returned ${measured.size} bytes of JSON, over the ` +
        `${max}-byte limit. Raise [agent].maxToolResultBytes or narrow the request.`,
      size: measured.size,
      max,
    });
  }
  // Re-wrapped for the same invariance reason as the `err` passthrough above:
  // the value is already the tool's own, unchanged.
  return ok(result._unsafeUnwrap() as T);
}

/**
 * Validate args and result in one call, for callers that hold both.
 *
 * The loop uses the two functions separately so it can audit `args` and
 * `result` rejections as distinct events, but a caller validating a
 * round-trip does not care which half failed.
 */
export function validateToolCall<T extends Record<string, unknown>>(
  tool: ToolDefinition,
  args: unknown,
  result: Result<unknown, StitchError>,
  limits: ValidationLimits = {}
): Result<{ args: T; result: unknown }, StitchError> {
  const safeArgs = sanitizeToolArgs<T>(tool, args, limits);
  if (safeArgs.isErr()) return err(safeArgs.error);
  const safeResult = validateToolResult<unknown>(tool, result, limits);
  if (safeResult.isErr()) return err(safeResult.error);
  return ok({ args: safeArgs.value, result: safeResult.value });
}

// ---------------------------------------------------------------------------
// Audit bridge
// ---------------------------------------------------------------------------

/**
 * Record a validation rejection on the P-145 audit trail.
 *
 * Kept beside the validators rather than inside them so the validators stay
 * pure (a test can assert on a rejection without standing up a database), and
 * so the loop decides what counts as worth auditing. The audit sink is optional
 * because pre-P-158 callers have none.
 */
export function auditValidationFailure(
  audit: { recordValidationFailure(record: ValidationFailureDetail): void } | undefined,
  tool: string,
  error: StitchError,
  stage: ValidationStage
): void {
  if (audit === undefined) return;
  if (error.code !== 'TOOL_ARGS_VALIDATION' && error.code !== 'TOOL_RESULT_TOO_LARGE') return;
  // `TOOL_ARGS_VALIDATION` covers four distinct checks; recover which one from
  // the message so the audit row is filterable by `kind` rather than a wall of
  // identical strings. P-139's own TOOL_ARGS_VALIDATION has no marker, so it
  // falls through as `invalid_json` only when the message matches nothing.
  const kind = classifyRejection(error.message, error.code);
  audit.recordValidationFailure({
    tool,
    stage,
    kind,
    reason: error.message,
    ...(error.code === 'TOOL_RESULT_TOO_LARGE' ? { size: error.size, max: error.max } : {}),
  });
}

function classifyRejection(message: string, code: StitchError['code']): ValidationKind {
  if (code === 'TOOL_RESULT_TOO_LARGE') return 'too_large';
  if (message.includes('prototype-polluting key')) return 'proto_pollution';
  if (message.includes('escapes the repository root')) return 'path_traversal';
  if (message.includes('nest deeper than')) return 'depth_exceeded';
  return 'invalid_json';
}

// ---------------------------------------------------------------------------
// Loop binding
// ---------------------------------------------------------------------------

/** Options for {@link createToolValidator}. */
export interface ToolValidatorOptions {
  /** Bound overrides, typically from the P-009 `[agent]` config block. */
  limits?: ValidationLimits;
  /**
   * P-145 audit sink. Optional so a caller with no database still gets
   * validation — losing a row is strictly better than skipping the check.
   */
  audit?: AiAuditLog;
}

/**
 * Bind the validators to a set of limits and an audit sink, producing the
 * `ToolValidator` the tool loop consumes.
 *
 * This factory is the cycle-breaker between the two modules. `ai/loop.ts`
 * cannot import this file (the agent module already imports `ai/`), so the
 * interface lives in `ai/types.ts` and the orchestrator — which depends on both
 * — wires the two together here. It is the same seam P-157 used for the
 * autonomy policy.
 *
 * Limits are bound at construction rather than passed per call so the loop
 * cannot accidentally apply a different bound to the args check than to the
 * result check.
 *
 * @param options - Bound limits and the audit sink
 * @returns A validator ready to inject into `LoopConfig.validation`
 */
export function createToolValidator(options: ToolValidatorOptions = {}): ToolValidator {
  const limits = options.limits ?? {};
  const audit = options.audit;
  return {
    sanitizeToolArgs<T extends Record<string, unknown>>(
      tool: ToolDefinition,
      args: unknown
    ): Result<T, StitchError> {
      return sanitizeToolArgs<T>(tool, args, limits);
    },
    validateToolResult(
      tool: ToolDefinition,
      result: Result<unknown, StitchError>
    ): Result<unknown, StitchError> {
      return validateToolResult<unknown>(tool, result, limits);
    },
    audit(error: StitchError, toolName: string, stage: ValidationStage): void {
      auditValidationFailure(audit, toolName, error, stage);
    },
  };
}

// Fuzzy SPDX normalization via `spdx-correct` (P-025).
//
// `normalizeLicense(raw)` maps messy third-party declared license strings
// to canonical SPDX ids (`Apache 2` → `Apache-2.0`, `mit` → `MIT`).
// It is the fuzzy step *before* strict parsing (P-024 `parseExpr`) in the
// normalization pipeline (P-119): raw manifest string → corrected id →
// strict AST → compatibility verdict (P-120) → license report (P-128).
//
// Unresolvable input resolves to the `UNKNOWN_LICENSE` sentinel (the P-123
// unknown path), *not* an err — the pipeline must keep flowing so the
// report can flag the package for human review instead of aborting.
//
// `spdx-correct@3` is CJS-only; we import via `createRequire` and type the
// single function we use inline (no upstream .d.ts, no @types/).

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { createRequire } from 'node:module';
import { parseExpr } from './expr.js';

const require = createRequire(import.meta.url);
const spdxCorrect: (identifier: string) => string | null = require('spdx-correct');

/**
 * Sentinel for license strings that cannot be resolved to a canonical
 * SPDX id. Same literal as the P-023 `scanDeclared` UNKNOWN sentinel and
 * the `license-checker` convention — one spelling everywhere.
 */
export const UNKNOWN_LICENSE = 'UNKNOWN' as const;

/**
 * Normalize a raw declared license string to a canonical SPDX id.
 *
 * Steps:
 *   1. Trim; empty input → ok(UNKNOWN_LICENSE).
 *   2. If the string already strict-parses (P-024 `parseExpr`) — including
 *      compound expressions like `(MIT OR Apache-2.0)` — pass it through
 *      untouched. `spdx-correct` only understands single ids; without this
 *      guard every compound expression would degrade to UNKNOWN.
 *   3. Otherwise fuzzy-correct via `spdxCorrect`; a non-null result is
 *      returned as-is (the lib only returns values that strict-parse).
 *   4. `null` → ok(UNKNOWN_LICENSE) — the P-123 unknown path.
 *
 * Returns err(INTERNAL) only if `spdx-correct` itself throws, which cannot
 * happen for guarded string input and would indicate an upstream bug.
 */
export function normalizeLicense(raw: string): Result<string, StitchError> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return ok(UNKNOWN_LICENSE);
  }
  if (parseExpr(trimmed).isOk()) {
    return ok(trimmed);
  }
  let corrected: string | null;
  try {
    corrected = spdxCorrect(trimmed);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown correction error';
    return err({
      code: 'INTERNAL',
      message: `spdx-correct failed for ${trimmed}: ${detail}`,
    });
  }
  if (corrected === null) {
    return ok(UNKNOWN_LICENSE);
  }
  return ok(corrected);
}

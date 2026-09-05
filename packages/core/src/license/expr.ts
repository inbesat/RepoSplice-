// Thin Result-returning wrapper around `spdx-expression-parse` (P-024).
//
// `parseExpr(expr)` parses an SPDX license expression string into a
// structured `LicenseExpr` AST (per the P-011 contract). Supports
// single licenses (`MIT`), compound expressions (`(MIT OR Apache-2.0)`),
// `+` suffixes (`GPL-3.0-or-later+`), and `WITH` exceptions
// (`GPL-2.0-only WITH Classpath-exception-2.0`).
//
// SPDX normalization happens here; the consumer (P-120 compatibility,
// P-122 dual-license, P-128 report) only ever sees a typed AST.
//
// `spdx-expression-parse@5` is CJS-only; we import via `createRequire`
// and type the result shape inline (no upstream .d.ts, no @types/).

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const spdxExpressionParse: (
  source: string
) => SpdxExpressionNode = require('spdx-expression-parse');

// Raw AST shape returned by spdx-expression-parse.
// We type only the fields we normalize; the library is permissive
// about extra metadata we don't surface.
interface SpdxExpressionNode {
  license?: string;
  plus?: boolean;
  exception?: string;
  left?: SpdxExpressionNode;
  conjunction?: 'and' | 'or';
  right?: SpdxExpressionNode;
}

/**
 * Normalized AST for an SPDX license expression.
 *
 * Single license: `{ kind: 'license', license, plus?, exception? }`
 * Compound:        `{ kind: 'compound', op: 'and'|'or', left, right }`
 */
export type LicenseExpr =
  | {
      kind: 'license';
      /** SPDX license identifier (e.g. `MIT`, `Apache-2.0`, `GPL-3.0-only`). */
      license: string;
      /** `+` suffix (deprecated SPDX-3 notation; preserved for round-tripping). */
      plus?: boolean;
      /** SPDX exception identifier (e.g. `Classpath-exception-2.0`). */
      exception?: string;
    }
  | {
      kind: 'compound';
      /** Operator joining `left` and `right`. */
      op: 'and' | 'or';
      left: LicenseExpr;
      right: LicenseExpr;
    };

/**
 * Parse a raw SPDX license expression into a normalized AST.
 *
 * Returns ok(ast) on success, or err(INTERNAL) for malformed input
 * (unknown tokens, mismatched parens, bad `WITH` exception, etc.).
 *
 * Examples:
 *   parseExpr('MIT')
 *     -> ok({ kind: 'license', license: 'MIT' })
 *   parseExpr('(MIT OR Apache-2.0)')
 *     -> ok({ kind: 'compound', op: 'or',
 *             left: { kind: 'license', license: 'MIT' },
 *             right: { kind: 'license', license: 'Apache-2.0' } })
 *   parseExpr('GPL-2.0-only WITH Classpath-exception-2.0')
 *     -> ok({ kind: 'license', license: 'GPL-2.0-only',
 *             exception: 'Classpath-exception-2.0' })
 */
export function parseExpr(input: string): Result<LicenseExpr, StitchError> {
  if (input.length === 0) {
    return err({
      code: 'INTERNAL',
      message: 'Empty SPDX expression',
    });
  }
  let raw: SpdxExpressionNode;
  try {
    raw = spdxExpressionParse(input);
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : 'unknown parse error';
    return err({
      code: 'INTERNAL',
      message: `Malformed SPDX expression: ${input} (${detail})`,
    });
  }
  return ok(normalize(raw));
}

/**
 * Recursively normalize the upstream AST into our `LicenseExpr` shape.
 * Throws only on an unknown upstream node shape (defensive — the
 * library is well-tested). Such a throw would indicate an upstream
 * change, which is a true bug.
 */
function normalize(node: SpdxExpressionNode): LicenseExpr {
  if (node.license !== undefined) {
    const result: Extract<LicenseExpr, { kind: 'license' }> = {
      kind: 'license',
      license: node.license,
    };
    if (node.plus) result.plus = node.plus;
    if (node.exception) result.exception = node.exception;
    return result;
  }
  if (node.left && node.right && node.conjunction) {
    return {
      kind: 'compound',
      op: node.conjunction,
      left: normalize(node.left),
      right: normalize(node.right),
    };
  }
  throw new Error('Unexpected spdx-expression-parse node shape');
}

/**
 * Convenience: list the set of distinct licenses referenced in an AST.
 * Useful for P-120 compatibility analysis (intersect each license
 * with the project's `config.licensePolicy.allow` set).
 */
export function collectLicenses(expr: LicenseExpr): string[] {
  if (expr.kind === 'license') return [expr.license];
  return [...collectLicenses(expr.left), ...collectLicenses(expr.right)];
}

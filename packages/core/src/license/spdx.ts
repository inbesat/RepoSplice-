// SPDX normalization and validation (P-119).
//
// Wraps `spdx-correct`, `spdx-license-list`, and `spdx-expression-parse`
// to provide canonical SPDX handling for the license pipeline.
// Used by P-119 (scan → normalize), P-120 (compatibility matrix), and
// P-122 (dual-license).

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const spdxCorrect: (id: string) => string | null = require('spdx-correct');
const spdxParse: (expr: string) => unknown = require('spdx-expression-parse');
const spdxListData: Record<string, unknown> = require('spdx-license-list');

// Build a Set of all valid SPDX ids for fuzzy matching (from spdx-license-list).
const validSpdxIds = new Set<string>(Object.keys(spdxListData));

/**
 * Normalize a raw declared license string to a canonical SPDX id.
 *
 * Steps:
 *   1. Trim; empty → return raw unchanged (P-123 will flag).
 *   2. Try spdx-correct; if non-null, return it (it is already canonical).
 *   3. Fallback: trim, normalize case, and attempt exact match against
 *      spdx-license-list ids (case-insensitive). If found, return canonical.
 *   4. Otherwise return raw unchanged (no crash, flagged in P-123).
 */
export function normalizeToSPDX(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return raw;
  // Fast path: spdx-correct handles most aliases and case variations
  const corrected = spdxCorrect(trimmed);
  if (corrected !== null) return corrected;
  // Fallback: case-insensitive exact match against the registry
  const lower = trimmed.toLowerCase();
  for (const id of validSpdxIds) {
    if (id.toLowerCase() === lower) return id;
  }
  // Also try without extra star or "license" noise: strip common suffixes
  const cleaned = trimmed
    .replace(/\s*\*$/, '')
    .replace(/\s+license$/i, '')
    .trim();
  if (cleaned !== trimmed) {
    const retry = spdxCorrect(cleaned);
    if (retry !== null) return retry;
    const lowerClean = cleaned.toLowerCase();
    for (const id of validSpdxIds) {
      if (id.toLowerCase() === lowerClean) return id;
    }
  }
  return raw;
}

/**
 * Validate an SPDX expression string (single or compound).
 * Returns true if spdx-expression-parse can parse it, false otherwise.
 * Handles trailing '+' and WITH exceptions via the parser.
 */
export function isValidSPDX(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return false;
  try {
    spdxParse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize an SPDX expression string.
 *
 * - Splits on OR/AND (preserving operators), normalizes each operand via
 *   normalizeToSPDX, and rejoins preserving original operators.
 * - Strips redundant outer parentheses and collapses whitespace.
 */
export function normalizeExpression(raw: string): string {
  // Collapse whitespace first, then split preserving operators
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return raw;

  // Split on OR/AND while preserving delimiters
  const parts: string[] = [];
  const regex = /\s+(OR|AND)\s+/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const operators: string[] = [];
  while ((match = regex.exec(collapsed)) !== null) {
    const before = collapsed.slice(lastIdx, match.index).trim();
    if (before.length > 0) parts.push(before);
    operators.push(match[1]!);
    lastIdx = match.index + match[0].length;
  }
  const tail = collapsed.slice(lastIdx).trim();
  if (tail.length > 0) parts.push(tail);

  if (parts.length === 0) return collapsed;
  if (operators.length === 0) {
    // Single operand — normalize it and strip outer parens if present
    const single = parts[0]!.replace(/^[(]\s*|\s*[)]$/g, '').trim();
    return normalizeToSPDX(single);
  }

  const normalizedParts = parts.map(p => {
    const stripped = p.replace(/^[(]\s*|\s*[)]$/g, '').trim();
    // Handle WITH: "GPL-3.0 WITH Classpath-exception-2.0" — normalize only the license part
    const withIdx = stripped.search(/\s+WITH\s+/i);
    if (withIdx >= 0) {
      const lic = stripped.slice(0, withIdx).trim();
      const exc = stripped.slice(withIdx).trim(); // includes " WITH ..."
      const normLic = normalizeToSPDX(lic);
      // Preserve WITH clause as-is (exception ids are already canonical)
      return `${normLic}${exc.slice(4)}`.replace(/\s+WITH\s+/i, ' WITH ');
    }
    return normalizeToSPDX(stripped);
  });

  // Rejoin with single spaces around operators
  let result = normalizedParts[0]!;
  for (let i = 0; i < operators.length; i++) {
    result += ` ${operators[i]} ${normalizedParts[i + 1]}`;
  }
  // Strip redundant outer parentheses that wrap the whole expression
  result = result.replace(/^[(]\s*(.*)\s*[)]$/, '$1').trim();
  return result;
}

/**
 * Parse an SPDX expression and return the set of license ids it contains.
 * For "GPL-3.0 WITH Classpath-exception-2.0", returns ["GPL-3.0"] (exception excluded).
 * For "(MIT OR Apache-2.0)", returns ["MIT","Apache-2.0"].
 */
export function parseLicenses(expr: string): string[] {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return [];
  try {
    const node = spdxParse(trimmed) as {
      license?: string;
      left?: unknown;
      right?: unknown;
      conjunction?: string;
    };
    const licenses: string[] = [];
    function walk(n: unknown): void {
      if (n === null || typeof n !== 'object') return;
      const obj = n as { license?: string; left?: unknown; right?: unknown; conjunction?: string };
      if (obj.license !== undefined) {
        licenses.push(obj.license);
        return;
      }
      if (obj.left !== undefined) walk(obj.left);
      if (obj.right !== undefined) walk(obj.right);
    }
    walk(node);
    // Dedupe preserve order
    return [...new Set(licenses)];
  } catch {
    // Fallback: split on OR/AND/WITH and extract first token of each part
    const withoutWith = trimmed.split(/\s+WITH\s+/i)[0]!;
    const parts = withoutWith.split(/\s+(?:OR|AND)\s+/);
    const out: string[] = [];
    for (const p of parts) {
      const cleaned = p.replace(/^[\s(]+|[\s)]+$/g, '').trim();
      if (cleaned.length > 0) {
        // Take first token before space/plus
        const token = cleaned.split(/\s/)[0]!.replace(/\+$/, '');
        if (token.length > 0) out.push(token);
      }
    }
    return [...new Set(out)];
  }
}

// Dual-license handling (P-122).
//
// Handles OR expressions like "MIT OR Apache-2.0" or "Apache-2.0 OR GPL-3.0".
// Under a dual license the user may choose either option, which can change
// compliance. This module parses OR branches, evaluates each against the
// policy, and picks the most permissive compliant option.

import { LICENSE_CATEGORIES } from './categories.js';
import type { LicenseCategory, LicensePolicy } from './types.js';

export interface DualDecision {
  expression: string;
  recommended: string;
  alternatives: string[];
  allCompliant: boolean;
  reasons: string[];
}

const permissivenessRank: Record<LicenseCategory, number> = {
  permissive: 0,
  'weak-copyleft': 1,
  'strong-copyleft': 2,
  'network-copyleft': 3,
  unknown: 4,
};

function categoryFor(id: string): LicenseCategory {
  return LICENSE_CATEGORIES[id] ?? 'unknown';
}

function stripOuterParens(s: string): string {
  let cur = s.trim();
  while (cur.startsWith('(') && cur.endsWith(')')) {
    let depth = 0;
    let balanced = true;
    for (let j = 0; j < cur.length; j++) {
      const ch = cur[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && j < cur.length - 1) {
        balanced = false;
        break;
      }
    }
    if (balanced) cur = cur.slice(1, -1).trim();
    else break;
  }
  return cur;
}

function splitTopLevel(expr: string): string[] {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return [];
  const branches: string[] = [];
  let depth = 0;
  let current = '';
  let i = 0;
  while (i < trimmed.length) {
    const remaining = trimmed.slice(i);
    if (depth === 0 && remaining.toUpperCase().startsWith(' OR ')) {
      branches.push(current.trim());
      current = '';
      i += 4;
      continue;
    }
    const ch = trimmed[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    current += ch;
    i++;
  }
  if (current.trim().length > 0) branches.push(current.trim());
  return branches.map(b => stripOuterParens(b)).filter(s => s.length > 0);
}

/**
 * Split an SPDX expression on top-level OR, respecting parentheses.
 * Keeps candidates ordered as written, strips outer parens.
 * Recursively flattens nested ORs so `(MIT OR Apache-2.0) OR BSD-3-Clause`
 * yields `['MIT','Apache-2.0','BSD-3-Clause']`.
 */
export function parseOrExpression(expr: string): string[] {
  const initial = splitTopLevel(expr);
  // Recursively expand any branch that still contains a top-level OR
  const result: string[] = [];
  for (const branch of initial) {
    // If branch still contains a top-level OR, it must have been wrapped in parens originally
    // and now unwrapped, so split it further.
    if (branch.toUpperCase().includes(' OR ')) {
      // Check if it actually splits at top level
      const sub = splitTopLevel(branch);
      if (sub.length > 1) {
        // Recurse
        for (const s of sub) {
          const expanded = parseOrExpression(s);
          result.push(...expanded);
        }
        continue;
      }
    }
    result.push(branch);
  }
  return result;
}

function isAllowed(category: LicenseCategory, policy: LicensePolicy): boolean {
  if (category === 'unknown') return false;
  return policy.allow.includes(
    category as 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft'
  );
}

export function chooseDualLicense(
  expr: string,
  policy: LicensePolicy,
  _targetLicense: string
): DualDecision {
  const branches = parseOrExpression(expr);
  const reasons: string[] = [];
  if (branches.length === 0) {
    return {
      expression: expr,
      recommended: expr,
      alternatives: [],
      allCompliant: false,
      reasons: ['empty expression'],
    };
  }

  const evaluated = branches.map(branch => {
    const withIdx = branch.search(/\s+WITH\s+/i);
    let licPart = branch;
    let hasWith = false;
    if (withIdx >= 0) {
      licPart = branch.slice(0, withIdx).trim();
      hasWith = true;
    }
    const cat = categoryFor(licPart);
    let effectiveCat: LicenseCategory = cat;
    let withNote: string | null = null;
    if (hasWith && cat === 'strong-copyleft') {
      effectiveCat = 'weak-copyleft';
      withNote = `branch ${branch} contains WITH exception, relaxed from ${cat} to ${effectiveCat} for linking`;
    }
    // Direct compliance check without importing checkCompatibility to avoid cycle
    const allowed = isAllowed(effectiveCat, policy);
    let isCompliant = allowed;
    // If WITH and it was strong, we may want to treat it as more permissive
    // The relaxation above already handles it; ensure note exists
    if (hasWith && effectiveCat === 'weak-copyleft' && policy.allow.includes('weak-copyleft')) {
      isCompliant = true;
      if (withNote === null) {
        withNote = `WITH exception relaxes ${licPart}`;
      }
    }
    // For unknown, isCompliant stays false (requires explicit allow)
    // Build compatibility reason for non-compliant
    let compatReasons: string[] = [];
    if (!isCompliant) {
      if (effectiveCat === 'unknown') {
        compatReasons = [`license ${licPart} is unknown`];
      } else {
        compatReasons = [
          `license ${licPart} category ${effectiveCat} not in allow list [${policy.allow.join(', ')}]`,
        ];
      }
    }
    return { branch, licPart, cat, effectiveCat, isCompliant, withNote, compatReasons, hasWith };
  });

  const compliant = evaluated.filter(e => e.isCompliant);
  const allCompliant = compliant.length === evaluated.length;

  // Pick recommended: most permissive compliant one, or if none, most permissive overall
  const candidates = compliant.length > 0 ? compliant : evaluated;
  candidates.sort((a, b) => {
    const rankA = permissivenessRank[a.effectiveCat] ?? 4;
    const rankB = permissivenessRank[b.effectiveCat] ?? 4;
    if (rankA !== rankB) return rankA - rankB;
    return a.branch.localeCompare(b.branch);
  });
  const recommended = candidates[0]!.branch;
  const alternatives = branches.filter(b => b !== recommended);

  for (const e of evaluated) {
    if (!e.isCompliant) {
      reasons.push(`branch ${e.branch} (${e.cat}) not compliant: ${e.compatReasons.join('; ')}`);
    }
    if (e.withNote !== null) reasons.push(e.withNote);
  }
  if (compliant.length === 0) {
    reasons.push('no permissive branch compliant under current policy');
  }

  return { expression: expr, recommended, alternatives, allCompliant, reasons };
}

// Unknown license detection and decision queue (P-123).
//
// Flags packages whose declared license cannot be evaluated by the matrix
// (UNKNOWN, empty, SEE LICENSE IN..., Custom, non-SPDX) and routes them
// into a decision queue that blocks C creation until resolved.

import { isValidSPDX } from './spdx.js';
import type { DeclaredLicense } from './scan.js';

export interface UnknownLicense {
  package: string;
  version: string;
  rawLicense: string;
  path?: string;
  decision: 'pending' | 'allow' | 'deny';
}

// In-memory decision store (P-230 will replace with bun:sqlite).
// Keyed by package name and by package@version for precision.
const decisionByPkg = new Map<string, 'allow' | 'deny'>();
const decisionByPkgVersion = new Map<string, 'allow' | 'deny'>();

// Current unknown list for getPendingUnknown() without args (as per spec).
let currentUnknown: UnknownLicense[] = [];

function isFlaggedAsUnknown(declared: DeclaredLicense): boolean {
  const raw = (declared.rawLicenses ?? declared.licenses).trim();
  const lic = declared.licenses.trim();

  // Empty / UNKNOWN sentinel
  if (raw.length === 0 || lic.length === 0) return true;
  const upperRaw = raw.toUpperCase();
  const upperLic = lic.toUpperCase();
  if (upperRaw === 'UNKNOWN' || upperLic === 'UNKNOWN') return true;
  if (upperRaw === 'UNLICENSED' || upperLic === 'UNLICENSED') {
    // UNLICENSED is not a valid SPDX id, but explicitly means no license – treat as unknown
    // so human must decide; isValidSPDX will be false anyway, but be explicit
    return true;
  }
  if (upperRaw.includes('SEE LICENSE') || upperLic.includes('SEE LICENSE')) return true;
  if (upperRaw.includes('CUSTOM') || upperLic.includes('CUSTOM')) return true;

  // Non-SPDX check via spdx-expression-parse
  // isValidSPDX returns false for non-parsable expressions
  if (!isValidSPDX(lic)) return true;

  return false;
}

function decisionForPackage(pkg: string, version: string): 'pending' | 'allow' | 'deny' {
  const keyWithVersion = `${pkg}@${version}`;
  const byVersion = decisionByPkgVersion.get(keyWithVersion);
  if (byVersion !== undefined) return byVersion;
  const byPkg = decisionByPkg.get(pkg);
  if (byPkg !== undefined) return byPkg;
  return 'pending';
}

/**
 * Flag all unknown/non-SPDX licenses, deduped by package@version.
 * All are decision:'pending' by default unless a prior recordLicenseDecision exists.
 * Lane-ful: never auto-drops, always surfaces or is explicitly overridden.
 */
export function detectUnknown(declared: DeclaredLicense[]): UnknownLicense[] {
  const seen = new Set<string>();
  const result: UnknownLicense[] = [];

  for (const entry of declared) {
    if (!isFlaggedAsUnknown(entry)) continue;

    const dedupeKey = `${entry.package}@${entry.version}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const raw = (entry.rawLicenses ?? entry.licenses).trim();
    // Prefer raw for display, but if raw is empty use lic
    const displayRaw = raw.length > 0 ? raw : entry.licenses;

    const decision = decisionForPackage(entry.package, entry.version);

    const unknown: UnknownLicense = {
      package: entry.package,
      version: entry.version,
      rawLicense: displayRaw,
      decision,
      ...(entry.path !== undefined ? { path: entry.path } : {}),
    };

    result.push(unknown);
  }

  // Sort for determinism (package name, then version)
  result.sort((a, b) => {
    if (a.package < b.package) return -1;
    if (a.package > b.package) return 1;
    if (a.version < b.version) return -1;
    if (a.version > b.version) return 1;
    return 0;
  });

  currentUnknown = result;
  return result;
}

/**
 * Record a human decision for a package (allow/deny). Moves it out of pending.
 * Key can be package name alone (applies to all versions) or package@version for precision.
 * Persists to an in-memory store; P-230 will add sqlite persistence.
 */
export function recordLicenseDecision(pkg: string, decision: 'allow' | 'deny'): void {
  // If pkg contains '@' and looks like package@version, store both forms
  // For simplicity, if it contains '@' after first char, treat as versioned
  const atIdx = pkg.lastIndexOf('@');
  // Scoped packages start with '@', so need atIdx >0
  if (atIdx > 0) {
    decisionByPkgVersion.set(pkg, decision);
    // Also update pkg-only map for backward compat if caller used versioned key
    // but getPendingUnknown for other versions of same pkg should not be affected
  } else {
    decisionByPkg.set(pkg, decision);
  }

  // Update currentUnknown in place so getPendingUnknown reflects it immediately
  for (const u of currentUnknown) {
    const pkgKey = `${u.package}@${u.version}`;
    const byVersion = decisionByPkgVersion.get(pkgKey);
    if (byVersion !== undefined) {
      u.decision = byVersion;
      continue;
    }
    const byPkg = decisionByPkg.get(u.package);
    if (byPkg !== undefined) {
      u.decision = byPkg;
    }
  }
}

/**
 * Return the current pending unknowns (decision === 'pending').
 * No args per spec – reflects the last detectUnknown result filtered by decisions.
 */
export function getPendingUnknown(): UnknownLicense[] {
  return currentUnknown.filter(u => u.decision === 'pending');
}

/** Test helper: clear all decisions and current unknown list. */
export function clearLicenseDecisionsForTests(): void {
  decisionByPkg.clear();
  decisionByPkgVersion.clear();
  currentUnknown = [];
}

/** Test helper: get all decisions (for debugging). */
export function getAllUnknownForTests(): UnknownLicense[] {
  return [...currentUnknown];
}

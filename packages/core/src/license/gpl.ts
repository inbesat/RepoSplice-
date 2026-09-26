// GPL/AGPL warning generation (P-121).
//
// Flags GPL-family licenses that carry linking obligations, with
// conservative defaults for JS/TS where imports count as linking.
// Provides actionable remediation suggestions.

import type { DeclaredLicense } from './scan.js';
import type { LicenseCategory } from './types.js';
import { LICENSE_CATEGORIES } from './categories.js';

export type GplSeverity = 'warning' | 'info';

export interface GplWarning {
  package: string;
  version: string;
  license: string;
  category: LicenseCategory;
  severity: GplSeverity;
  suggestion: string;
}

export const GPL_REMEDIATIONS: Record<string, string> = {
  replace:
    'Replace package with a permissive alternative (e.g., MIT/Apache-2.0) — see https://choosealicense.com',
  vendor:
    'Vendor under separate module and enforce dynamic boundary (e.g., subprocess or microservice) to avoid static linking',
  notice:
    'Include GPL notice and offer source as required by GPL (provide Corresponding Source with distribution)',
  permission:
    'Obtain written permission from the copyright holder to relicense or grant an exception',
};

function isGplFamily(category: LicenseCategory): boolean {
  return category === 'strong-copyleft' || category === 'network-copyleft';
}

function isWeakCopyleft(category: LicenseCategory): boolean {
  return category === 'weak-copyleft';
}

function suggestionFor(pkg: string, license: string, _isJsTs: boolean): string {
  // Conservative: for JS/TS, any strong/network copyleft gets the full set
  // For non-JS, we still provide the same suggestions but could be more lenient
  // We always include at least one actionable suggestion
  if (license.includes('GPL-3.0') || license.includes('GPL-2.0')) {
    return `${GPL_REMEDIATIONS.replace} — alternative for ${pkg} (${license}); or ${(GPL_REMEDIATIONS.vendor ?? '').toLowerCase()}; or ${(GPL_REMEDIATIONS.notice ?? '').toLowerCase()}`;
  }
  if (license.includes('AGPL') || license.includes('SSPL')) {
    return `${GPL_REMEDIATIONS.replace} — network-copyleft ${license} for ${pkg} requires source offering for network use; or ${(GPL_REMEDIATIONS.permission ?? '').toLowerCase()}`;
  }
  return `${GPL_REMEDIATIONS.replace} for ${pkg} (${license})`;
}

export function checkGpl(declared: DeclaredLicense[], isJsTs: boolean): GplWarning[] {
  const warnings: GplWarning[] = [];
  for (const entry of declared) {
    const raw = entry.licenses;
    // Handle UNKNOWN and empty quickly
    if (raw === 'UNKNOWN' || raw.trim().length === 0) continue;
    // Split on OR/AND to check each license in the expression
    const parts = raw.split(/\s+(?:OR|AND)\s+/).map(p => p.replace(/^\(\s*|\s*\)$/g, '').trim());
    for (const part of parts) {
      // Strip WITH exception and trailing +
      const lic = part
        .split(/\s+WITH\s+/i)[0]!
        .replace(/\+$/, '')
        .trim();
      const cat: LicenseCategory = LICENSE_CATEGORIES[lic] ?? 'unknown';
      if (isWeakCopyleft(cat)) continue; // LGPL/MPL handled as weak, not GPL warning
      if (!isGplFamily(cat)) continue;
      // For JS/TS, any GPL family dep is warning (conservative)
      // For non-JS, we use heuristic: if it's a direct dep that ships source-interop, warn; else info
      // For now, we treat all GPL family as warning, but non-JS with unknown interop could be info
      // To satisfy spec: non-JS direct dep with wasm/native addon -> warning, else info
      // We don't have interop info, so for non-JS we downgrade to info unless it's clearly GPL
      let severity: GplSeverity = 'warning';
      if (!isJsTs) {
        // Simple heuristic: if package name suggests wasm/native, keep warning, else info
        const lowerPkg = entry.package.toLowerCase();
        const isNative =
          lowerPkg.includes('wasm') || lowerPkg.includes('native') || lowerPkg.includes('addon');
        if (!isNative) {
          severity = 'info';
        }
      }
      warnings.push({
        package: entry.package,
        version: entry.version,
        license: lic,
        category: cat,
        severity,
        suggestion: suggestionFor(entry.package, lic, isJsTs),
      });
    }
  }
  // Dedupe by package@license
  const seen = new Set<string>();
  const deduped: GplWarning[] = [];
  for (const w of warnings) {
    const key = `${w.package}@${w.license}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(w);
  }
  return deduped;
}

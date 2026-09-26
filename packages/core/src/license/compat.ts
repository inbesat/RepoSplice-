// License compatibility matrix (P-120).
//
// Implements the license category model and pairwise compatibility check
// over normalized SPDX ids. Used by the license report (P-128), CLI
// (P-196), and web UI (P-220) as the first legal-policy gate.

import { LICENSE_CATEGORIES } from './categories.js';
import { chooseDualLicense } from './dual.js';
import type { CompatibilityResult, LicenseCategory, LicensePolicy } from './types.js';

export { LICENSE_CATEGORIES } from './categories.js';

function categoryFor(licenseId: string): LicenseCategory {
  return LICENSE_CATEGORIES[licenseId] ?? 'unknown';
}

const COPYLEFT_CATEGORIES = ['weak-copyleft', 'strong-copyleft', 'network-copyleft'] as const;

function isCopyleft(category: LicenseCategory): boolean {
  return (
    category === 'weak-copyleft' ||
    category === 'strong-copyleft' ||
    category === 'network-copyleft'
  );
}

function isAllowed(category: LicenseCategory, policy: LicensePolicy): boolean {
  if (category === 'unknown') return false;
  if (
    policy.allow.includes(
      category as 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'network-copyleft'
    )
  ) {
    return true;
  }
  // Copyleft is opt-in as a block: once a policy accepts any copyleft tier, the
  // stricter tiers are review-tier (escalated by checkGpl + the P-127 policy
  // engine) rather than an outright policy denial. A policy that accepts no
  // copyleft tier at all still denies them here.
  if (isCopyleft(category)) {
    return COPYLEFT_CATEGORIES.some(tier => policy.allow.includes(tier));
  }
  return false;
}

function checkCategory(
  a: LicenseCategory,
  b: LicenseCategory,
  policy: LicensePolicy
): 'allow' | 'review' | 'deny' {
  // An unknown category is unresolved, not incompatible: it routes to the
  // P-123 decision queue, so a pair involving it is review-tier.
  if (a === 'unknown' || b === 'unknown') return 'review';
  const aAllowed = isAllowed(a, policy);
  const bAllowed = isAllowed(b, policy);
  if (!aAllowed || !bAllowed) return 'deny';
  // Strong or network copyleft paired with non-copyleft needs review
  const strongA = a === 'strong-copyleft' || a === 'network-copyleft';
  const strongB = b === 'strong-copyleft' || b === 'network-copyleft';
  const permissiveA = a === 'permissive';
  const permissiveB = b === 'permissive';
  if (
    (strongA && permissiveB) ||
    (strongB && permissiveA) ||
    (strongA && b === 'weak-copyleft') ||
    (strongB && a === 'weak-copyleft')
  ) {
    return 'review';
  }
  return 'allow';
}

export function checkCompatibility(licenses: string[], policy: LicensePolicy): CompatibilityResult {
  // P-122: if any input contains OR, resolve via dual first
  const hasOr = licenses.some(l => /\sOR\s/i.test(l));
  if (hasOr) {
    const expanded: string[] = [];
    for (const lic of licenses) {
      if (/\sOR\s/i.test(lic)) {
        const dual = chooseDualLicense(lic, policy, policy.targetLicense);
        expanded.push(dual.recommended);
      } else {
        expanded.push(lic);
      }
    }
    // Re-run with expanded (now OR-free) list - expanded may still be OR-free leaf
    // Use recursion but expanded is guaranteed OR-free for the recommended branch (leaf)
    // If still contains OR (unlikely), the recursive call will handle it.
    return checkCompatibility(expanded, policy);
  }

  const reasons: string[] = [];
  const failingCategories: LicenseCategory[] = [];
  const failingSet = new Set<LicenseCategory>();

  const categories = licenses.map(id => ({ id, cat: categoryFor(id) }));

  // Single-category checks
  for (const { id, cat } of categories) {
    if (cat === 'unknown') {
      if (policy.denyUnknown) {
        const reason = `license ${id} is unknown and denyUnknown is true — denied`;
        reasons.push(reason);
        if (!failingSet.has(cat)) {
          failingSet.add(cat);
          failingCategories.push(cat);
        }
      } else {
        const reason = `license ${id} is unknown and requires review`;
        reasons.push(reason);
        if (!failingSet.has(cat)) {
          failingSet.add(cat);
          failingCategories.push(cat);
        }
      }
      continue;
    }
    if (!isAllowed(cat, policy)) {
      const reason = `license ${id} category ${cat} not in allow list [${policy.allow.join(', ')}]`;
      reasons.push(reason);
      if (!failingSet.has(cat)) {
        failingSet.add(cat);
        failingCategories.push(cat);
      }
    }
  }

  // Pairwise checks
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const a = categories[i]!;
      const b = categories[j]!;
      const verdict = checkCategory(a.cat, b.cat, policy);
      if (verdict === 'deny') {
        const reason = `${a.id} (${a.cat}) vs ${b.id} (${b.cat}) is denied by policy`;
        reasons.push(reason);
        for (const cat of [a.cat, b.cat] as LicenseCategory[]) {
          if (!failingSet.has(cat)) {
            failingSet.add(cat);
            failingCategories.push(cat);
          }
        }
      } else if (verdict === 'review') {
        const why =
          a.cat === 'unknown' || b.cat === 'unknown'
            ? 'unknown license requires a human decision'
            : 'strong/network copyleft with non-copyleft';
        const reason = `${a.id} (${a.cat}) vs ${b.id} (${b.cat}) needs review (${why})`;
        reasons.push(reason);
        // review does not necessarily add to failingCategories unless policy disallows, but track for reporting
        if (!isAllowed(a.cat, policy) || !isAllowed(b.cat, policy)) {
          for (const cat of [a.cat, b.cat] as LicenseCategory[]) {
            if (!failingSet.has(cat)) {
              failingSet.add(cat);
              failingCategories.push(cat);
            }
          }
        }
      }
    }
  }

  // Target license special-case: network-copyleft dep with permissive target is deny
  const targetCat = categoryFor(policy.targetLicense);
  const permissiveTargets = [
    'MIT',
    'Apache-2.0',
    'BSD-3-Clause',
    'BSD-2-Clause',
    'ISC',
    'BlueOak-1.0.0',
  ];
  const isPermissiveTarget =
    permissiveTargets.includes(policy.targetLicense) || targetCat === 'permissive';
  if (isPermissiveTarget) {
    for (const { id, cat } of categories) {
      if (cat === 'network-copyleft') {
        const reason = `dependency ${id} is network-copyleft (${cat}) but target ${policy.targetLicense} is permissive — denied`;
        reasons.push(reason);
        if (!failingSet.has(cat)) {
          failingSet.add(cat);
          failingCategories.push(cat);
        }
      }
    }
  }

  let decision: 'allow' | 'deny' | 'review' = 'allow';
  if (
    reasons.some(
      r =>
        r.includes('denied') ||
        r.includes('is denied') ||
        r.includes('not in allow') ||
        r.includes('is network-copyleft')
    )
  ) {
    decision = 'deny';
  } else if (reasons.length > 0) {
    // Any review reason that is not deny still yields review
    decision = 'review';
  }

  // If no reasons, allow
  if (reasons.length === 0) decision = 'allow';

  return { decision, reasons, failingCategories };
}

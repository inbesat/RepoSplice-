import { describe, it, expect } from 'vitest';
import { checkCompatibility, LICENSE_CATEGORIES } from './compat.js';
import type { LicensePolicy } from './types.js';

const permissivePolicy: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

const permissiveWithUnknownDeny: LicensePolicy = {
  allow: ['permissive'],
  denyUnknown: true,
  requireAttribution: true,
  targetLicense: 'MIT',
};

const allAllowPolicy: LicensePolicy = {
  allow: ['permissive', 'weak-copyleft', 'strong-copyleft', 'network-copyleft'],
  denyUnknown: false,
  requireAttribution: true,
  targetLicense: 'MIT',
};

describe('P-120 compat: allows permissive only', () => {
  it('allows MIT under permissive', () => {
    const result = checkCompatibility(['MIT'], permissivePolicy);
    expect(result.decision).toBe('allow');
    expect(result.reasons).toEqual([]);
    expect(result.failingCategories).toEqual([]);
  });
});

describe('P-120 compat: reviews strong-copyleft pair', () => {
  it('reviews MIT + GPL-3.0', () => {
    const result = checkCompatibility(['MIT', 'GPL-3.0-only'], permissivePolicy);
    // MIT is allowed, GPL is not allowed under permissive only, so deny or review
    expect(['review', 'deny']).toContain(result.decision);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join(' ')).toMatch(/GPL/);
  });
});

describe('P-120 compat: denies AGPL with permissive target', () => {
  it('denies AGPL with MIT target', () => {
    const result = checkCompatibility(['AGPL-3.0-only'], permissivePolicy);
    expect(result.decision).toBe('deny');
    expect(result.reasons.join(' ')).toMatch(/network-copyleft|AGPL/);
    expect(result.failingCategories).toContain('network-copyleft');
  });
});

describe('P-120 compat: handles unknown per denyUnknown', () => {
  it('denies unknown when denyUnknown true', () => {
    const result = checkCompatibility(['CustomLicense-1.0'], permissiveWithUnknownDeny);
    expect(result.decision).toBe('deny');
    expect(result.failingCategories).toContain('unknown');
  });

  it('reviews unknown when denyUnknown false', () => {
    const result = checkCompatibility(['CustomLicense-1.0'], permissivePolicy);
    expect(result.decision).toBe('review');
    expect(result.failingCategories).toContain('unknown');
  });
});

describe('P-120 compat: reasons explain decision', () => {
  it('reasons explain failing pair', () => {
    const result = checkCompatibility(['MIT', 'GPL-3.0-only'], permissivePolicy);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toBeDefined();
    expect(typeof result.reasons[0]).toBe('string');
  });
});

describe('P-120 compat: covers all categories map', () => {
  it('every SPDX id maps to a valid category', () => {
    for (const [id, cat] of Object.entries(LICENSE_CATEGORIES)) {
      expect([
        'permissive',
        'weak-copyleft',
        'strong-copyleft',
        'network-copyleft',
        'unknown',
      ]).toContain(cat);
      expect(id.length).toBeGreaterThan(0);
    }
    expect(Object.keys(LICENSE_CATEGORIES).length).toBeGreaterThan(20);
  });

  it('unknown fallback works', () => {
    const result = checkCompatibility(['NonExistent-9.9'], allAllowPolicy);
    // Non-existent is unknown, with denyUnknown false it should be review
    expect(result.decision).toBe('review');
    expect(result.failingCategories).toContain('unknown');
  });
});

describe('P-130 compat: matrix property', () => {
  it('matrix never throws for any category pair', () => {
    const sample = ['MIT', 'LGPL-3.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'CustomLicense-1.0'];
    const policies: LicensePolicy[] = [permissivePolicy, permissiveWithUnknownDeny, allAllowPolicy];
    for (const policy of policies) {
      for (const a of sample) {
        const single = checkCompatibility([a], policy);
        expect(['allow', 'review', 'deny']).toContain(single.decision);
        expect(Array.isArray(single.reasons)).toBe(true);
        expect(Array.isArray(single.failingCategories)).toBe(true);
        for (const b of sample) {
          const result = checkCompatibility([a, b], policy);
          expect(['allow', 'review', 'deny']).toContain(result.decision);
          expect(Array.isArray(result.reasons)).toBe(true);
          expect(Array.isArray(result.failingCategories)).toBe(true);
        }
      }
    }
  });
});

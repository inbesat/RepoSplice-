// P-026 tests: lookupLicense covers known ids, unknown ids (typed err),
// OSI flag, plus isKnown convenience and the bundled registry size.
import { describe, it, expect } from 'vitest';
import { lookupLicense, isKnown, size } from './spdxIndex.js';

describe('P-026 lookupLicense: known id (spec smoke test)', () => {
  it('returns metadata for MIT', () => {
    const r = lookupLicense('MIT');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.id).toBe('MIT');
      expect(r.value.name).toBe('MIT License');
      expect(r.value.url).toBe('https://opensource.org/license/mit/');
      expect(r.value.osiApproved).toBe(true);
    }
  });

  it('returns metadata for Apache-2.0 (osi approved)', () => {
    const r = lookupLicense('Apache-2.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.osiApproved).toBe(true);
      expect(r.value.name).toBe('Apache License 2.0');
    }
  });

  it('returns metadata for WTFPL (osi NOT approved)', () => {
    const r = lookupLicense('WTFPL');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.osiApproved).toBe(false);
    }
  });

  it('returns metadata for SSPL-1.0 (osi NOT approved, copyleft-network)', () => {
    const r = lookupLicense('SSPL-1.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.osiApproved).toBe(false);
      expect(r.value.name).toContain('Server Side Public License');
    }
  });
});

describe('P-026 lookupLicense: unknown id (spec smoke test)', () => {
  it('returns typed UNKNOWN_LICENSE err for an id not in the registry', () => {
    const r = lookupLicense('not-a-real-spdx-id-xyz');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('UNKNOWN_LICENSE');
      if (r.error.code === 'UNKNOWN_LICENSE') {
        expect(r.error.id).toBe('not-a-real-spdx-id-xyz');
      }
    }
  });

  it('returns typed UNKNOWN_LICENSE err for empty input', () => {
    const r = lookupLicense('');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('UNKNOWN_LICENSE');
    }
  });

  it('returns typed UNKNOWN_LICENSE err for whitespace input', () => {
    const r = lookupLicense('   ');
    expect(r.isErr()).toBe(true);
  });
});

describe('P-026 isKnown: boolean validation', () => {
  it('returns true for known ids', () => {
    expect(isKnown('MIT')).toBe(true);
    expect(isKnown('Apache-2.0')).toBe(true);
  });

  it('returns false for unknown ids', () => {
    expect(isKnown('not-a-real-spdx-id-xyz')).toBe(false);
  });

  it('returns false for empty/whitespace input', () => {
    expect(isKnown('')).toBe(false);
    expect(isKnown('   ')).toBe(false);
  });
});

describe('P-026 size: bundled registry', () => {
  it('exposes the bundled entry count (>700, current bundle is 727)', () => {
    const s = size();
    expect(s).toBeGreaterThan(700);
    expect(s).toBeLessThan(1000);
  });
});

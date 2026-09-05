// P-025 tests: normalizeLicense corrects aliases, passes valid input
// through, and resolves the unresolvable to UNKNOWN (never err).
import { describe, it, expect } from 'vitest';
import { normalizeLicense, UNKNOWN_LICENSE } from './normalize.js';

describe('P-025 normalizeLicense: corrects aliases (spec smoke test)', () => {
  it('corrects `Apache 2` to `Apache-2.0`', () => {
    const r = normalizeLicense('Apache 2');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe('Apache-2.0');
    }
  });

  it('corrects `GPLv2` to `GPL-2.0-only`', () => {
    const r = normalizeLicense('GPLv2');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe('GPL-2.0-only');
    }
  });

  it('uppercases a lowercase id (`mit` → `MIT`)', () => {
    const r = normalizeLicense('mit');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe('MIT');
    }
  });
});

describe('P-025 normalizeLicense: valid input passes through', () => {
  it('returns an already-canonical id untouched', () => {
    const r = normalizeLicense('MIT');
    if (r.isErr()) throw r.error;
    expect(r.value).toBe('MIT');
  });

  it('does not degrade compound expressions to UNKNOWN', () => {
    const r = normalizeLicense('(MIT OR Apache-2.0)');
    if (r.isErr()) throw r.error;
    expect(r.value).toBe('(MIT OR Apache-2.0)');
  });
});

describe('P-025 normalizeLicense: unknown path (spec smoke test)', () => {
  it('resolves unresolvable input to UNKNOWN, not err', () => {
    const r = normalizeLicense('not-a-license-xyz');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe(UNKNOWN_LICENSE);
    }
  });

  it('resolves empty/whitespace input to UNKNOWN', () => {
    for (const raw of ['', '   ']) {
      const r = normalizeLicense(raw);
      expect(r.isOk()).toBe(true);
      if (r.isOk()) {
        expect(r.value).toBe(UNKNOWN_LICENSE);
      }
    }
  });
});

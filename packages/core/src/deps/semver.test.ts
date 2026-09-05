// P-019 smoke test: confirms the semver wrapper's Result-returning
// helpers behave as expected on a fixture set of ranges + versions.
// Covers validRange, coerce, satisfies, and the spec-required
// `intersect` collision-resolution path.
import { describe, it, expect } from 'vitest';
import { validRange, coerce, satisfies, intersects } from './semver.js';

describe('P-019 semver: validRange', () => {
  it('accepts a caret range', () => {
    const r = validRange('^1.0.0');
    expect(r.isOk()).toBe(true);
  });

  it('accepts a tilde range', () => {
    const r = validRange('~1.1.0');
    expect(r.isOk()).toBe(true);
  });

  it('accepts an exact pin', () => {
    const r = validRange('1.2.3');
    expect(r.isOk()).toBe(true);
  });

  it('accepts wildcard (any version)', () => {
    expect(validRange('*').isOk()).toBe(true);
  });

  it('rejects garbage with a typed CONFIG_ERROR', () => {
    const r = validRange('not-a-range');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('range');
      }
    }
  });

  it('treats empty string as "*" (any) — semver lib behavior, not an error', () => {
    // semver's validRange('') returns the empty-set range, which the lib
    // treats as "any version". This is lib behavior, not a bug. Callers
    // that want strict validation should pre-check the input (ConfigSchema
    // does this for the config surface). For other callers, prefer
    // validRange('*') to be explicit.
    expect(validRange('').isOk()).toBe(true);
  });
});

describe('P-019 semver: coerce', () => {
  it('coerces "1" to 1.0.0', () => {
    const r = coerce('1');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.version).toBe('1.0.0');
  });

  it('coerces "1.2" to 1.2.0', () => {
    const r = coerce('1.2');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.version).toBe('1.2.0');
  });

  it('coerces "v1.2.3" to 1.2.3 (strips v prefix)', () => {
    const r = coerce('v1.2.3');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.version).toBe('1.2.3');
  });

  it('coerces "1.2.3-rc.1" preserving prerelease', () => {
    const r = coerce('1.2.3-rc.1');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value.version).toBe('1.2.3-rc.1');
  });

  it('rejects non-version strings with typed CONFIG_ERROR', () => {
    const r = coerce('not-a-version');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('version');
      }
    }
  });
});

describe('P-019 semver: satisfies', () => {
  it('1.2.3 satisfies ^1.0.0', () => {
    const r = satisfies('1.2.3', '^1.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(true);
  });

  it('1.2.3 satisfies ~1.2.0', () => {
    const r = satisfies('1.2.3', '~1.2.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(true);
  });

  it('1.2.3 does NOT satisfy ^2.0.0', () => {
    const r = satisfies('1.2.3', '^2.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(false);
  });

  it('returns err when range is invalid', () => {
    const r = satisfies('1.2.3', 'nope');
    expect(r.isErr()).toBe(true);
  });
});

describe('P-019 semver: intersects (P-109 collision resolver)', () => {
  it('overlapping ranges intersect (^1.0.0 and ~1.1.0)', () => {
    const r = intersects('^1.0.0', '~1.1.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(true);
  });

  it('overlapping ranges intersect (^1.0.0 and ^1.2.0)', () => {
    const r = intersects('^1.0.0', '^1.2.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(true);
  });

  it('disjoint ranges do NOT intersect (^1.0.0 and ^2.0.0)', () => {
    const r = intersects('^1.0.0', '^2.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(false);
  });

  it('returns err when either input is not a valid range', () => {
    const r = intersects('^1.0.0', 'nope');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('range');
      }
    }
  });
});

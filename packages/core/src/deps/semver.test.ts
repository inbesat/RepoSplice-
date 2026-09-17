// P-019 smoke test: confirms the semver wrapper's Result-returning
// helpers behave as expected on a fixture set of ranges + versions.
// Covers validRange, coerce, satisfies, and the spec-required
// `intersect` collision-resolution path.
//
// P-109 extends this file with the collision resolver suite:
// `resolveCollision` (narrowest intersection, disjoint, invalid,
// wildcard/tilde/hyphen/prerelease handling) and `maxSatisfying`
// (highest satisfying version for the UI preview), plus the
// resolveCollision -> maxSatisfying round-trip the spec describes.
import { describe, it, expect } from 'vitest';
import {
  validRange,
  coerce,
  satisfies,
  intersects,
  resolveCollision,
  toSuggestedResolution,
  maxSatisfying,
} from './semver.js';

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

describe('P-109 semver: resolveCollision', () => {
  it('intersects compatible ranges', () => {
    // ^1.2.3 is the narrower range (B ⊆ A) — the spec's narrowest logic
    // returns it, matching the acceptance criterion exactly.
    const r = resolveCollision('^1.0.0', '^1.2.3');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.kind).toBe('resolved');
      if (r.value.kind === 'resolved') {
        expect(r.value.range).toBe('^1.2.3');
        expect(r.value.basis).toBe('subset-b');
      }
    }
    // The underlying P-019 primitive agrees the ranges intersect.
    const i = intersects('^1.0.0', '^1.2.3');
    expect(i.isOk()).toBe(true);
    if (i.isOk()) expect(i.value).toBe(true);
    // Symmetric narrowest pick: ~1.2.3 is narrower than ^1.2.3 (A ⊆ B).
    const r2 = resolveCollision('~1.2.3', '^1.2.3');
    expect(r2.isOk()).toBe(true);
    if (r2.isOk()) {
      if (r2.value.kind === 'resolved') {
        expect(r2.value.range).toBe('~1.2.3');
        expect(r2.value.basis).toBe('subset-a');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('returns null for major conflict', () => {
    const r = resolveCollision('^1.0.0', '^2.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.kind).toBe('disjoint');
      expect(toSuggestedResolution(r.value)).toBeNull();
      if (r.value.kind === 'disjoint') {
        expect(r.value.reason).toContain('^1.0.0');
        expect(r.value.reason).toContain('^2.0.0');
      }
    }
    // Disjointness is symmetric: reversed inputs classify the same way.
    const r2 = resolveCollision('^2.0.0', '^1.0.0');
    expect(r2.isOk()).toBe(true);
    if (r2.isOk()) {
      expect(r2.value.kind).toBe('disjoint');
      expect(toSuggestedResolution(r2.value)).toBeNull();
    }
  });

  it('handles wildcards', () => {
    // '*' is the full set: the specific side is the narrowest intersection.
    const specific = resolveCollision('*', '^1.0.0');
    expect(specific.isOk()).toBe(true);
    if (specific.isOk()) {
      if (specific.value.kind === 'resolved') {
        expect(specific.value.range).toBe('^1.0.0');
        expect(specific.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    const half = resolveCollision('*', '>1.0');
    expect(half.isOk()).toBe(true);
    if (half.isOk()) {
      if (half.value.kind === 'resolved') {
        expect(half.value.range).toBe('>1.0');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // '*' against itself is the identical fast path.
    const any = resolveCollision('*', '*');
    expect(any.isOk()).toBe(true);
    if (any.isOk()) {
      if (any.value.kind === 'resolved') {
        expect(any.value.range).toBe('*');
        expect(any.value.basis).toBe('identical');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // A wildcard on one side cannot rescue garbage on the other.
    const bad = resolveCollision('*', 'garbage');
    expect(bad.isOk()).toBe(true);
    if (bad.isOk()) {
      expect(bad.value.kind).toBe('invalid');
      expect(toSuggestedResolution(bad.value)).toBeNull();
    }
  });

  it('handles prerelease', () => {
    // Identical prerelease pins are the identical fast path.
    const same = resolveCollision('1.0.0-beta.1', '1.0.0-beta.1');
    expect(same.isOk()).toBe(true);
    if (same.isOk()) {
      if (same.value.kind === 'resolved') {
        expect(same.value.range).toBe('1.0.0-beta.1');
        expect(same.value.basis).toBe('identical');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // A prerelease-tolerant lower bound (^1.0.0-0) admits the pin:
    // includePrerelease:true is threaded (either range has a prerelease).
    const tolerant = resolveCollision('^1.0.0-0', '1.0.0-beta.1');
    expect(tolerant.isOk()).toBe(true);
    if (tolerant.isOk()) {
      if (tolerant.value.kind === 'resolved') {
        expect(tolerant.value.range).toBe('1.0.0-beta.1');
        expect(tolerant.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // A prerelease point below a caret's lower bound is honestly disjoint —
    // semver precedence puts 1.0.0-beta.1 before 1.0.0, and includePrerelease
    // does not change comparator interval math (probed against the raw lib).
    const below = resolveCollision('^1.0.0', '1.0.0-beta.1');
    expect(below.isOk()).toBe(true);
    if (below.isOk()) {
      expect(below.value.kind).toBe('disjoint');
      expect(toSuggestedResolution(below.value)).toBeNull();
    }
    // A prerelease caret against its release caret resolves to the release
    // side: with includePrerelease:true, ^1.2.3 ⊆ ^1.2.3-beta (probed).
    const caret = resolveCollision('^1.2.3-beta', '^1.2.3');
    expect(caret.isOk()).toBe(true);
    if (caret.isOk()) {
      if (caret.value.kind === 'resolved') {
        expect(caret.value.range).toBe('^1.2.3');
        expect(caret.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('returns null for invalid range', () => {
    // Garbage on one side: the typed invalid classification, never a throw.
    const oneSided = resolveCollision('not-a-range', '^1.0.0');
    expect(oneSided.isOk()).toBe(true);
    if (oneSided.isOk()) {
      expect(oneSided.value.kind).toBe('invalid');
      expect(toSuggestedResolution(oneSided.value)).toBeNull();
      if (oneSided.value.kind === 'invalid') {
        expect(oneSided.value.reason).toContain('not-a-range');
      }
    }
    // Garbage on both sides still classifies (validation runs BEFORE the
    // identical fast path — a garbage pair can never "resolve" to itself).
    const both = resolveCollision('garbage', 'garbage');
    expect(both.isOk()).toBe(true);
    if (both.isOk()) {
      expect(both.value.kind).toBe('invalid');
      expect(toSuggestedResolution(both.value)).toBeNull();
    }
  });

  it('returns rangeA for identical ranges', () => {
    const caret = resolveCollision('^1.0.0', '^1.0.0');
    expect(caret.isOk()).toBe(true);
    if (caret.isOk()) {
      if (caret.value.kind === 'resolved') {
        expect(caret.value.range).toBe('^1.0.0');
        expect(caret.value.basis).toBe('identical');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // X-range strings pass through untouched on the identical path.
    const xrange = resolveCollision('1.x', '1.x');
    expect(xrange.isOk()).toBe(true);
    if (xrange.isOk()) {
      if (xrange.value.kind === 'resolved') {
        expect(xrange.value.range).toBe('1.x');
        expect(xrange.value.basis).toBe('identical');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('conjoins partially overlapping ranges', () => {
    // Overlapping but neither contains the other: the space-joined
    // conjunction (semver interprets space as AND) is the narrowest form.
    const caret = resolveCollision('^1.0.0', '>=0.5.0 <1.3.0');
    expect(caret.isOk()).toBe(true);
    if (caret.isOk()) {
      if (caret.value.kind === 'resolved') {
        expect(caret.value.basis).toBe('conjunction');
        expect(caret.value.range).toBe('^1.0.0 >=0.5.0 <1.3.0');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // Closed intervals: overlap [1.2.0, 1.5.0], neither side a subset.
    const closed = resolveCollision('>=1.0.0 <=1.5.0', '>=1.2.0 <=2.0.0');
    expect(closed.isOk()).toBe(true);
    if (closed.isOk()) {
      if (closed.value.kind === 'resolved') {
        expect(closed.value.basis).toBe('conjunction');
        expect(closed.value.range).toBe('>=1.0.0 <=1.5.0 >=1.2.0 <=2.0.0');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('handles hyphen ranges and exact pins', () => {
    // ^1.5.0 is the narrower range inside the 1.0.0 - 2.0.0 span
    // (probed: semver.subset('^1.5.0','1.0.0 - 2.0.0') is true — the
    // span canonicalizes with a prerelease upper bound the caret is a
    // subset of, but not vice versa).
    const hyphen = resolveCollision('1.0.0 - 2.0.0', '^1.5.0');
    expect(hyphen.isOk()).toBe(true);
    if (hyphen.isOk()) {
      if (hyphen.value.kind === 'resolved') {
        expect(hyphen.value.range).toBe('^1.5.0');
        expect(hyphen.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // An exact pin inside a tilde range: the pin is the subset side.
    const pin = resolveCollision('~1.2.3', '1.2.3');
    expect(pin.isOk()).toBe(true);
    if (pin.isOk()) {
      if (pin.value.kind === 'resolved') {
        expect(pin.value.range).toBe('1.2.3');
        expect(pin.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
    // '>1.0' canonicalizes to >=1.1.0, which contains the tilde range.
    const loose = resolveCollision('>1.0', '~1.2.3');
    expect(loose.isOk()).toBe(true);
    if (loose.isOk()) {
      if (loose.value.kind === 'resolved') {
        expect(loose.value.range).toBe('~1.2.3');
        expect(loose.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('treats empty string ranges as any version', () => {
    // validRange('') is '*' (valid, any) — so '' vs '^1.0.0' resolves to
    // the specific side, exactly like the wildcard case.
    const r = resolveCollision('', '^1.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      if (r.value.kind === 'resolved') {
        expect(r.value.range).toBe('^1.0.0');
        expect(r.value.basis).toBe('subset-b');
      } else {
        expect.unreachable('expected a resolved range');
      }
    }
  });

  it('does not throw on any input pair', () => {
    const oddInputs = [
      '',
      ' ',
      '*',
      'v1.0.0',
      '1.x',
      '>1.0',
      '>=1.0.0-0',
      '~1.2.3',
      '^1.0.0-beta',
      '1.0.0-beta.1',
      '1.0.0 - 2.0.0',
      'not-a-range',
      'garbage',
      '1.2.3',
      '>=1.0.0 <=1.5.0',
      'latest',
      'file:../dep',
    ];
    for (const a of oddInputs) {
      for (const b of oddInputs) {
        // Never throws: any uncaught exception fails this test outright.
        // The loop completing over all 289 pairs IS the no-throw proof.
        const r = resolveCollision(a, b);
        if (r.isOk()) {
          if (r.value.kind !== 'resolved') {
            // Every non-resolved classification maps to the spec's null.
            expect(toSuggestedResolution(r.value)).toBeNull();
          } else {
            // Every resolved range is a non-empty string.
            expect(r.value.range.length).toBeGreaterThan(0);
          }
        } else {
          expect(r.error.code).toBe('INTERNAL');
        }
      }
    }
  });
});

describe('P-109 semver: maxSatisfying', () => {
  it('picks the highest version satisfying a conjunction range', () => {
    // The space-joined form from resolveCollision: both ranges ANDed.
    const conjunction = maxSatisfying(['4.17.20', '4.17.21'], '^4.17.20 ^4.17.21');
    expect(conjunction.isOk()).toBe(true);
    if (conjunction.isOk()) expect(conjunction.value).toBe('4.17.21');

    // The real resolveCollision -> maxSatisfying composition.
    const resolved = resolveCollision('^1.0.0', '>=0.5.0 <1.3.0');
    expect(resolved.isOk()).toBe(true);
    if (resolved.isOk()) {
      const suggestion = toSuggestedResolution(resolved.value);
      expect(suggestion).toBe('^1.0.0 >=0.5.0 <1.3.0');
      const picked = maxSatisfying(['1.0.0', '1.2.9', '1.4.0'], suggestion ?? '');
      expect(picked.isOk()).toBe(true);
      if (picked.isOk()) expect(picked.value).toBe('1.2.9');
    }
  });

  it('returns null when nothing satisfies', () => {
    // The registry stub has no version in range.
    const miss = maxSatisfying(['4.17.20', '4.17.21'], '^1.0.0');
    expect(miss.isOk()).toBe(true);
    if (miss.isOk()) expect(miss.value).toBeNull();
    // An empty list is the same legitimate outcome.
    const empty = maxSatisfying([], '^1.0.0');
    expect(empty.isOk()).toBe(true);
    if (empty.isOk()) expect(empty.value).toBeNull();
  });

  it('errs with a typed CONFIG_ERROR on an invalid range', () => {
    // The raw lib swallows invalid ranges as an ambiguous null; the typed
    // err keeps "no match" and "bad input" distinguishable, never throws.
    const r = maxSatisfying(['1.2.3'], 'garbage');
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('CONFIG_ERROR');
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('range');
        expect(r.error.message).toContain('garbage');
      }
    }
  });

  it('skips unparsable versions in the list', () => {
    // Garbage entries never break the pick (raw-lib behavior, probed).
    const r = maxSatisfying(['garbage', '1.2.3'], '^1.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('1.2.3');
  });

  it('matches exact prerelease pins without options', () => {
    // A range pinning the same prerelease as the entry matches exactly.
    const r = maxSatisfying(['1.0.0-beta.1'], '1.0.0-beta.1');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('1.0.0-beta.1');
    // Without includePrerelease, release ranges skip prerelease entries.
    const strict = maxSatisfying(['1.2.3-beta'], '^1.0.0');
    expect(strict.isOk()).toBe(true);
    if (strict.isOk()) expect(strict.value).toBeNull();
  });

  it('picks prereleases when includePrerelease is passed', () => {
    const r = maxSatisfying(['1.2.3-beta', '1.0.0'], '^1.0.0', { includePrerelease: true });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('1.2.3-beta');
  });

  it('returns the input form of the winning version', () => {
    // A 'v'-prefixed entry wins as 'v1.2.3' — the raw lib preserves the
    // input form; callers get back exactly what they passed.
    const r = maxSatisfying(['v1.2.3', '1.0.0'], '^1.0.0');
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('v1.2.3');
  });
});

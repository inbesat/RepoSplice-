// P-111 tests: dedupe/nest strategy for npm version collisions.
// Every case is built through real semver ranges (no hand-shaped AST),
// and the spec's mock registry list ['4.17.20','4.17.21'] is used for
// hoist verification. Covers the three spec-required cases plus
// peer-involved nesting, overrides fallback, legacy npm, invalid/empty
// inputs, and the reason string for P-116.
import { describe, expect, it } from 'vitest';
import { chooseDedupeStrategy } from './dedupe.js';
import { unionManifests } from './merge.js';
import { parsePackageJson } from './parse/npm.js';
import type { ParsedManifest } from './types.js';

function mustNpm(content: string, path: string): ParsedManifest {
  const r = parsePackageJson(content, path);
  expect(r.isOk()).toBe(true);
  if (r.isErr()) throw new Error(`npm fixture failed to parse: ${path}`);
  return r.value;
}

describe('P-111 dedupe: hoists compatible patch versions', () => {
  it('hoists lodash ^4.17.20 + ^4.17.21 to 4.17.21', () => {
    const result = chooseDedupeStrategy(['4.17.20', '4.17.21'], {
      'repo-a': '^4.17.20',
      'repo-b': '^4.17.21',
    });
    expect(result.strategy).toBe('hoist');
    expect(result.version).toBe('4.17.21');
    expect(result.reason).toContain('hoisted');
    expect(result.reason).toContain('4.17.21');
  });

  it('hoists compatible caret ranges with highest satisfying version', () => {
    const result = chooseDedupeStrategy(['1.0.0', '1.2.0', '1.2.3', '2.0.0'], {
      'repo-a': '^1.0.0',
      'repo-b': '^1.2.0',
    });
    // Intersect is ^1.2.0, highest satisfying is 1.2.3
    expect(result.strategy).toBe('hoist');
    expect(result.version).toBe('1.2.3');
  });

  it('hoists with wildcard and greater-than ranges', () => {
    const result = chooseDedupeStrategy(['2.0.0', '2.1.0', '3.0.0'], {
      'repo-a': '*',
      'repo-b': '>1.0',
    });
    // "*" is any, so intersect is >1.0, highest is 3.0.0
    expect(result.strategy).toBe('hoist');
    expect(result.version).toBe('3.0.0');
  });
});

describe('P-111 dedupe: nests major mismatch', () => {
  it('nests react 17 + 18 with major mismatch reason', () => {
    const result = chooseDedupeStrategy(['17.0.0', '18.0.0'], {
      'repo-a': '17',
      'repo-b': '18',
    });
    expect(result.strategy).toBe('nest');
    expect(result.version).toBe('');
    expect(result.reason).toContain('major version mismatch');
    expect(result.reason).toContain('nested node_modules');
  });

  it('nests caret major mismatch ^17.0.0 vs ^18.0.0', () => {
    const result = chooseDedupeStrategy(['17.0.0', '18.0.0'], {
      'repo-a': '^17.0.0',
      'repo-b': '^18.0.0',
    });
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('major version mismatch');
  });

  it('nests exact major mismatch 1.0.0 vs 2.0.0', () => {
    const result = chooseDedupeStrategy(['1.0.0', '2.0.0'], {
      'repo-a': '1.0.0',
      'repo-b': '2.0.0',
    });
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('major version mismatch');
  });
});

describe('P-111 dedupe: chooses overrides when npm supports', () => {
  it('hoists with overrides when npm 8.3+ and no major mismatch', () => {
    // Two disjoint ranges with same major but no overlap (e.g. exact pins)
    const result = chooseDedupeStrategy(
      ['1.0.0', '1.0.1'],
      {
        'repo-a': '1.0.0',
        'repo-b': '1.0.1',
      },
      { npmVersion: '8.3.0' }
    );
    expect(result.strategy).toBe('hoist');
    expect(result.reason).toContain('overrides');
    expect(result.reason).toContain('8.3.0');
  });

  it('hoists with overrides defaulting to npm 8 when no version given', () => {
    const result = chooseDedupeStrategy(['1.0.0', '1.0.1'], {
      'repo-a': '1.0.0',
      'repo-b': '1.0.1',
    });
    // Default npm 8 supports overrides
    expect(result.strategy).toBe('hoist');
    expect(result.reason).toContain('overrides');
    expect(result.reason).toContain('8 (default)');
  });

  it('nests legacy when npm <8.3.0 without overrides', () => {
    const result = chooseDedupeStrategy(
      ['1.0.0', '1.0.1'],
      {
        'repo-a': '1.0.0',
        'repo-b': '1.0.1',
      },
      { npmVersion: '7.0.0' }
    );
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('does not support overrides');
    expect(result.reason).toContain('legacy');
  });

  it('nests legacy when npm version is 6.x', () => {
    const result = chooseDedupeStrategy(
      ['1.0.0', '1.0.1'],
      {
        'repo-a': '1.0.0',
        'repo-b': '1.0.1',
      },
      { npmVersion: '6.14.0' }
    );
    expect(result.strategy).toBe('nest');
  });
});

describe('P-111 dedupe: peer-involved conflict prefers nest', () => {
  it('nests when peer involved even with overrides available', () => {
    const result = chooseDedupeStrategy(
      ['1.0.0', '1.0.1'],
      {
        'repo-a': '^1.0.0',
        'repo-b': '^1.0.1',
      },
      { npmVersion: '8.3.0', peerInvolved: true }
    );
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('peer dependency involved');
    expect(result.reason).toContain('nested node_modules');
  });

  it('peer involved takes precedence over major mismatch', () => {
    const result = chooseDedupeStrategy(
      ['17.0.0', '18.0.0'],
      {
        'repo-a': '17',
        'repo-b': '18',
      },
      { peerInvolved: true }
    );
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('peer dependency involved');
  });

  it('peer not involved allows hoist for compatible ranges', () => {
    const result = chooseDedupeStrategy(
      ['4.17.20', '4.17.21'],
      {
        'repo-a': '^4.17.20',
        'repo-b': '^4.17.21',
      },
      { peerInvolved: false }
    );
    expect(result.strategy).toBe('hoist');
    expect(result.version).toBe('4.17.21');
  });
});

describe('P-111 dedupe: error cases', () => {
  it('returns error for empty requested', () => {
    const result = chooseDedupeStrategy(['1.0.0'], {});
    expect(result.strategy).toBe('error');
    expect(result.reason).toContain('no requested ranges');
  });

  it('returns error when no available version satisfies intersect', () => {
    const result = chooseDedupeStrategy(['2.0.0', '3.0.0'], {
      'repo-a': '^1.0.0',
      'repo-b': '^1.0.0',
    });
    // Intersect is ^1.0.0, but versions are 2.0.0 and 3.0.0 which don't satisfy
    expect(result.strategy).toBe('error');
    expect(result.reason).toContain('no available version satisfies');
  });

  it('returns hoist with empty version when no registry versions provided but intersect exists', () => {
    const result = chooseDedupeStrategy([], {
      'repo-a': '^4.17.20',
      'repo-b': '^4.17.21',
    });
    expect(result.strategy).toBe('hoist');
    expect(result.version).toBe('');
    expect(result.reason).toContain('no registry versions provided');
  });

  it('handles invalid range as no intersect via peer/major/overrides logic', () => {
    const result = chooseDedupeStrategy(
      ['1.0.0'],
      {
        'repo-a': 'not-a-range',
        'repo-b': '^1.0.0',
      },
      { npmVersion: '8.3.0' }
    );
    // Invalid range leads to no intersect, same major? Coerce fails so not major mismatch -> overrides hoist
    expect(result.strategy).toBe('hoist');
    expect(result.reason).toContain('overrides');
  });

  it('handles all invalid ranges', () => {
    const result = chooseDedupeStrategy(
      ['1.0.0'],
      {
        'repo-a': 'garbage',
        'repo-b': 'not-a-range',
      },
      { npmVersion: '7.0.0' }
    );
    expect(result.strategy).toBe('nest');
    expect(result.reason).toContain('does not support overrides');
  });
});

describe('P-111 dedupe: reason string for P-116 report', () => {
  it('includes reason for hoist case', () => {
    const result = chooseDedupeStrategy(['1.2.3'], { 'repo-a': '^1.0.0' });
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.strategy).toBe('hoist');
  });

  it('includes reason for nest major mismatch', () => {
    const result = chooseDedupeStrategy(['1.0.0', '2.0.0'], {
      'repo-a': '1.0.0',
      'repo-b': '2.0.0',
    });
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.strategy).toBe('nest');
  });

  it('includes reason for error case', () => {
    const result = chooseDedupeStrategy([], {}, {});
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.strategy).toBe('error');
  });
});

describe('P-111 dedupe: end-to-end via merge', () => {
  it('sets dedupeStrategy on version conflicts via merge', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { react: '^17.0.0' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('version');
    expect(conflict.dedupeStrategy).toBe('nest');
    expect(conflict.severity).toBe('error');
  });

  it('peer-involved version conflict nests via merge integration', () => {
    const a = mustNpm(
      JSON.stringify({
        dependencies: { react: '^18.0.0' },
        peerDependencies: { react: '^18.0.0' },
      }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({
        dependencies: { react: '^17.0.0' },
        peerDependencies: { react: '^17.0.0' },
      }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    const versionConflict = r.value.conflicts.find(c => c.type === 'version');
    expect(versionConflict).toBeDefined();
    if (versionConflict === undefined) return;
    expect(versionConflict.dedupeStrategy).toBe('nest');
  });

  it('compatible version ranges produce version conflict with hoist dedupe', () => {
    const a = mustNpm(
      JSON.stringify({ dependencies: { lodash: '^4.17.20' } }),
      'repo-a/package.json'
    );
    const b = mustNpm(
      JSON.stringify({ dependencies: { lodash: '^4.17.21' } }),
      'repo-b/package.json'
    );
    const r = unionManifests([a, b]);
    expect(r.isOk()).toBe(true);
    if (r.isErr()) return;
    // Differing strings produce a version conflict even though ranges
    // intersect — dedupe then decides hoist.
    expect(r.value.conflicts).toHaveLength(1);
    const conflict = r.value.conflicts[0];
    expect(conflict).toBeDefined();
    if (conflict === undefined) return;
    expect(conflict.type).toBe('version');
    expect(conflict.dedupeStrategy).toBe('hoist');
  });
});

// P-320 — the bun-side mirror of the mandated python schema tests.
//
// The corpus contract is enforced in CI (which is bun-only) by this file;
// `packages/core/test_eval_schema.py` carries the mandated pytest ids for
// the python side (the corpus validator itself is standard library only).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVAL_ECOSYSTEMS,
  EVAL_OUTCOMES,
  evalPairJsonSchema,
  evalPairSchema,
} from '../eval/schema.js';
import { LICENSE_CATEGORIES } from '../license/categories.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'eval', 'corpus', 'schema.json');
const MANIFEST_PATH = join(REPO_ROOT, 'eval', 'corpus', 'pairs.json');
const EXAMPLE_PATH = join(REPO_ROOT, 'eval', 'corpus', 'pair-example', 'pair.json');

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const example = readJson(EXAMPLE_PATH);

describe('eval corpus schema (P-320)', () => {
  it('accepts the example pair', () => {
    const result = evalPairSchema.safeParse(example);
    expect(result.success).toBe(true);
  });

  it('rejects a bad sha', () => {
    const result = evalPairSchema.safeParse({ ...example, repo_a_sha: 'not-a-sha' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown ecosystem', () => {
    const result = evalPairSchema.safeParse({ ...example, ecosystem: 'cobol' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing field', () => {
    const rest: Record<string, unknown> = { ...example };
    delete rest['pair_id'];
    const result = evalPairSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('keeps unknown fields for corpus expansion', () => {
    const result = evalPairSchema.safeParse({ ...example, note: 'added in P-332' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['note']).toBe('added in P-332');
    }
  });

  it('exposes the plan enums', () => {
    expect(EVAL_ECOSYSTEMS).toEqual(['js', 'python', 'go', 'rust']);
    expect(EVAL_OUTCOMES).toEqual(['clean', 'conflicts', 'license_block', 'semantic_drift']);
  });

  it('the committed json schema matches the emitted one', () => {
    // Semantic comparison: lint-staged may reformat the committed file
    // (prettier), so the bytes can differ while the schema is identical.
    const committed = readJson(SCHEMA_PATH);
    expect(committed).toEqual(evalPairJsonSchema());
  });

  it('the corpus manifest parses', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown[];
    expect(Array.isArray(manifest)).toBe(true);
    for (const entry of manifest) {
      expect(evalPairSchema.safeParse(entry).success).toBe(true);
    }
  });
});

// P-321 — the sourced corpus (20 real repo pairs). The python mirror with
// the mandated pytest ids lives in `eval/test_corpus.py`.
describe('eval corpus (P-321)', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, unknown>[];

  it('holds 20 sourced pairs', () => {
    expect(manifest.length).toBe(20);
  });

  it('balances 5 pairs per ecosystem', () => {
    const counts = new Map<string, number>();
    for (const pair of manifest) {
      const ecosystem = String(pair['ecosystem']);
      counts.set(ecosystem, (counts.get(ecosystem) ?? 0) + 1);
    }
    for (const ecosystem of EVAL_ECOSYSTEMS) {
      expect(counts.get(ecosystem) ?? 0).toBe(5);
    }
  });

  it('uses unique pair ids', () => {
    const ids = manifest.map(pair => String(pair['pair_id']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates every pair against the schema', () => {
    for (const pair of manifest) {
      expect(evalPairSchema.safeParse(pair).success).toBe(true);
    }
  });

  it('pins every side to a 40 hex sha', () => {
    for (const pair of manifest) {
      expect(String(pair['repo_a_sha'])).toMatch(/^[0-9a-f]{40}$/);
      expect(String(pair['repo_b_sha'])).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('uses permissive licenses only', () => {
    for (const pair of manifest) {
      for (const side of ['license_a', 'license_b']) {
        expect(LICENSE_CATEGORIES[String(pair[side])]).toBe('permissive');
      }
    }
  });
});

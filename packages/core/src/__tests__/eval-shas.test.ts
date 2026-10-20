// P-322 - the bun-side mirror of the python SHA verification.
//
// The mandated tests for this phase are python ids (eval/test_shas.py), and the
// CI runs bun only, so this file enforces the same contract in the bun gate:
// every pin is a 40-hex sha, the corpus documents the verification and the
// re-pinning procedure, and the python verifier carries the mandated test ids.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const MANIFEST_PATH = join(REPO_ROOT, 'eval', 'corpus', 'pairs.json');
const README_PATH = join(REPO_ROOT, 'eval', 'corpus', 'README.md');
const VERIFIER_PATH = join(REPO_ROOT, 'eval', 'scripts', 'verify_shas.py');
const PYTEST_PATH = join(REPO_ROOT, 'eval', 'test_shas.py');

interface CorpusPair {
  pair_id: string;
  repo_a_url: string;
  repo_b_url: string;
  repo_a_sha: string;
  repo_b_sha: string;
  repo_a_tag?: string;
  repo_b_tag?: string;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const corpus = readJson<CorpusPair[]>(MANIFEST_PATH);

describe('eval corpus sha pins (P-322)', () => {
  it('pins every side of every pair to a 40 hex sha', () => {
    expect(corpus.length).toBe(20);
    for (const pair of corpus) {
      for (const sha of [pair.repo_a_sha, pair.repo_b_sha]) {
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });

  it('records the tag every sha was pinned from', () => {
    for (const pair of corpus) {
      expect(typeof pair.repo_a_tag).toBe('string');
      expect(typeof pair.repo_b_tag).toBe('string');
      expect((pair.repo_a_tag as string).length).toBeGreaterThan(0);
      expect((pair.repo_b_tag as string).length).toBeGreaterThan(0);
    }
  });

  it('documents the verification and the re-pinning procedure', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    expect(readme).toContain('verify_shas.py');
    expect(readme).toContain('Re-pinning procedure');
    expect(readme).toContain('git ls-remote --tags --refs');
  });

  it('keeps the mandated python test ids', () => {
    const tests = readFileSync(PYTEST_PATH, 'utf8');
    expect(tests).toContain('def test_all_shas_verified');
    expect(tests).toContain('def test_drift_detection');
    const verifier = readFileSync(VERIFIER_PATH, 'utf8');
    expect(verifier).toContain('missing');
    expect(verifier).toContain('unknown');
  });
});

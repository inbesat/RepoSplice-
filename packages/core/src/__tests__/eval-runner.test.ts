// P-323 — the bun-side mirror of the eval harness contract.
//
// The CI is bun-only, so this file enforces what the python tests assert:
// the per-pair result shape, the parallel bound, the emitted result schema
// and the failure capture (one broken pair must not hide the others).

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { err, ok } from 'neverthrow';
import { EvalRunner, type EvalPorts } from '../eval/runner.js';
import { evalResultJsonSchema, evalResultSchema } from '../eval/types.js';
import type { StitchError } from '../result/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

const PAIR = {
  pair_id: 'mirror-1',
  repo_a_url: 'https://github.com/example/alpha',
  repo_b_url: 'https://github.com/example/beta',
  repo_a_sha: '1111111111111111111111111111111111111111',
  repo_b_sha: '2222222222222222222222222222222222222222',
  extract_paths_a: ['./src'],
  extract_paths_b: ['./src'],
  ecosystem: 'js',
  license_a: 'MIT',
  license_b: 'MIT',
  expected_outcome: 'clean',
};

const PAIR_B = { ...PAIR, pair_id: 'mirror-2', repo_a_url: 'https://github.com/example/gamma' };

function ports(failingUrl?: string): EvalPorts {
  return {
    clone: async (url, targetDir) => {
      if (failingUrl !== undefined && url === failingUrl) {
        return err({ code: 'GIT_ERROR', message: `clone failed for ${url}` });
      }
      return ok(targetDir);
    },
    extract: async repoPath => ok(repoPath),
    agent: async () => ok({ tokens: 7, cost: 0.02 }),
    sandbox: async () => ok({ buildPass: true }),
    now: () => Date.now(),
    mkdirp: async () => undefined,
    writeJson: async () => undefined,
  };
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eval-mirror-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeCorpus(pairs: unknown[]): Promise<string> {
  const file = join(workDir, 'corpus.json');
  await writeFile(file, JSON.stringify(pairs), 'utf8');
  return file;
}

describe('eval runner (P-323)', () => {
  it('a single pair emits the required fields', async () => {
    const corpus = await writeCorpus([PAIR]);
    const runner = new EvalRunner(ports());
    const result = await runner.run(corpus, { outputDir: join(workDir, 'out') });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const [first] = result.value.results;
    expect(first?.pair_id).toBe('mirror-1');
    expect(first?.status).toBe('succeeded');
    expect(first?.build_pass).toBe(true);
    expect(first?.tokens).toBe(7);
    expect(first?.cost).toBe(0.02);
    expect(first?.duration).not.toBeNull();
    expect(first?.error_code).toBeNull();
    expect(result.value.pairs).toBe(1);
    expect(result.value.succeeded).toBe(1);
    expect(result.value.failed).toBe(0);
  });

  it('respects the parallel bound', async () => {
    const corpus = await writeCorpus([PAIR, PAIR_B]);
    const serial = await new EvalRunner(ports()).run(corpus, {
      outputDir: join(workDir, 'out-serial'),
      parallel: 1,
    });
    expect(serial.isOk()).toBe(true);
    if (serial.isOk()) expect(serial.value.max_concurrency).toBe(1);
    const parallel = await new EvalRunner(ports()).run(corpus, {
      outputDir: join(workDir, 'out-parallel'),
      parallel: 2,
    });
    expect(parallel.isOk()).toBe(true);
    if (parallel.isOk()) {
      expect(parallel.value.max_concurrency).toBeLessThanOrEqual(2);
      expect(parallel.value.parallel).toBe(2);
    }
  });

  it('the result json validates against the emitted result schema', async () => {
    const corpus = await writeCorpus([PAIR]);
    const result = await new EvalRunner(ports()).run(corpus, { outputDir: join(workDir, 'out') });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const parsed = evalResultSchema.safeParse(result.value.results[0]);
    expect(parsed.success).toBe(true);
    const committed = JSON.parse(
      await readFile(join(REPO_ROOT, 'eval', 'corpus', 'result-schema.json'), 'utf8')
    ) as unknown;
    expect(committed).toEqual(evalResultJsonSchema());
  });

  it('captures a failing step and keeps going', async () => {
    const corpus = await writeCorpus([PAIR, PAIR_B]);
    const result = await new EvalRunner(ports(PAIR.repo_a_url)).run(corpus, {
      outputDir: join(workDir, 'out'),
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const failed = result.value.results.find(entry => entry.pair_id === 'mirror-1');
    const passed = result.value.results.find(entry => entry.pair_id === 'mirror-2');
    expect(failed?.status).toBe('failed');
    expect(failed?.error_code).toBe('GIT_ERROR');
    expect(failed?.error_message).toContain('clone failed');
    expect(passed?.status).toBe('succeeded');
    expect(result.value.failed).toBe(1);
    expect(result.value.succeeded).toBe(1);
  });

  it('reports an unusable corpus as a config error', async () => {
    const corpus = await writeCorpus([{ ...PAIR, ecosystem: 'cobol' }]);
    const result = await new EvalRunner(ports()).run(corpus, { outputDir: join(workDir, 'out') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    const error: StitchError = result.error;
    expect(error.code).toBe('CONFIG_ERROR');
  });
});

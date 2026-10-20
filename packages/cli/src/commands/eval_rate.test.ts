// P-326 — the rater tool's contract: a rating is captured, validated by the
// REAL rubric schema, and written back into the pair's result JSON without
// touching the harness data around it.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evalRate, RATE_EXIT_CANCELLED, RATE_EXIT_OK, RATE_EXIT_USAGE } from './eval_rate.js';
import type { EvalRateOptions } from './eval_rate.js';

const GLOBALS: EvalRateOptions = { verbose: false, yes: false, offline: false, color: false };

const RESULT = {
  pair_id: 'fixture-js-1',
  status: 'succeeded',
  build_pass: true,
  build_logs: ['build ok'],
  test_logs: ['tests ok'],
  tokens: 12,
  cost: 0.01,
  duration: 100,
  error_code: null,
  error_message: null,
};

const dirs: string[] = [];

function makeResultDir(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'stitch-rate-'));
  dirs.push(dir);
  const path = join(dir, 'fixture-js-1.json');
  writeFileSync(path, `${JSON.stringify(RESULT, null, 2)}\n`, 'utf8');
  return { dir, path };
}

afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('eval rate (P-326)', () => {
  it('saves the rubric into the result JSON', async () => {
    const { dir, path } = makeResultDir();
    const answers = ['4', '5', '4', 'wiring is solid'];
    let index = 0;
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      { prompt: async () => answers[index++] ?? null, log: () => undefined }
    );
    expect(code).toBe(RATE_EXIT_OK);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(saved['human_rater']).toBe('rater-x');
    expect(saved['human_score']).toEqual({
      pair_id: 'fixture-js-1',
      rater: 'rater-x',
      wiring_correctness: 4,
      unnecessary_changes: 5,
      respects_patterns: 4,
      notes: 'wiring is solid',
    });
  });

  it('keeps the harness data around the rubric', async () => {
    const { dir, path } = makeResultDir();
    const answers = ['3', '3', '4', 'ok'];
    let index = 0;
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      { prompt: async () => answers[index++] ?? null, log: () => undefined }
    );
    expect(code).toBe(RATE_EXIT_OK);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(saved['pair_id']).toBe('fixture-js-1');
    expect(saved['status']).toBe('succeeded');
    expect(saved['build_pass']).toBe(true);
    expect(saved['build_logs']).toEqual(['build ok']);
  });

  it('refuses a missing result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stitch-rate-'));
    dirs.push(dir);
    const code = await evalRate(
      'nope',
      { ...GLOBALS, resultDir: dir },
      { prompt: async () => '4', log: () => undefined }
    );
    expect(code).toBe(RATE_EXIT_USAGE);
  });

  it('refuses a score outside 1-5', async () => {
    const { dir, path } = makeResultDir();
    const answers = ['6', '4', '4', 'ok'];
    let index = 0;
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      { prompt: async () => answers[index++] ?? null, log: () => undefined }
    );
    expect(code).toBe(RATE_EXIT_USAGE);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(saved['human_score']).toBeUndefined();
  });

  it('saves nothing when the rater cancels', async () => {
    const { dir, path } = makeResultDir();
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      { prompt: async () => null, log: () => undefined }
    );
    expect(code).toBe(RATE_EXIT_CANCELLED);
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(saved['human_score']).toBeUndefined();
  });

  it('degrades to cancelled when the prompt surface breaks', async () => {
    const { dir } = makeResultDir();
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      {
        prompt: async () => {
          throw new Error('no tty');
        },
        log: () => undefined,
      }
    );
    expect(code).toBe(RATE_EXIT_CANCELLED);
  });

  it('reports the diff artifact when the harness left one', async () => {
    const { dir } = makeResultDir();
    writeFileSync(join(dir, 'fixture-js-1.diff'), '--- a\n+++ b\n', 'utf8');
    const lines: string[] = [];
    const answers = ['5', '5', '5', 'good'];
    let index = 0;
    const code = await evalRate(
      'fixture-js-1',
      { ...GLOBALS, resultDir: dir, rater: 'rater-x' },
      { prompt: async () => answers[index++] ?? null, log: line => lines.push(line) }
    );
    expect(code).toBe(RATE_EXIT_OK);
    expect(lines.some(line => line.includes('diff '))).toBe(true);
    expect(existsSync(join(dir, 'fixture-js-1.diff'))).toBe(true);
  });
});

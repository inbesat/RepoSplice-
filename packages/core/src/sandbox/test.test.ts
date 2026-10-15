// P-172 — sandbox test-run tests.
//
// The container client is a fake (`TestClient`), so no daemon and no runner are
// touched: the tests feed SAMPLED runner output through `runTests` and assert
// the parsed counts, the bounded failure list, the verdict semantics, and the
// offline switch.
//
// The six required scenarios from the phase spec:
//
//   it('reports passing suite')          it('reports failing suite with failures')
//   it('falls back to exit code')        it('errors on infra')
//   it('selects command per eco')        it('honors offline')

import { describe, it, expect } from 'vitest';
import { ok, err } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import type { ContainerRun, ContainerSpec, RunOptions } from './client.js';
import { MAX_BUILD_LOG_LINES, WORKSPACE_MOUNT } from './build.js';
import {
  MAX_TEST_FAILURES,
  TEST_COMMANDS,
  looksLikeJunit,
  parseJunitXml,
  parseTestOutput,
  runTests,
  type TestClient,
} from './test.js';

interface FakeOutcome {
  exitCode?: number;
  stdout?: string[];
  stderr?: string[];
  durationMs?: number;
  error?: StitchError;
}

function makeFakeClient(outcome: FakeOutcome = {}): {
  client: TestClient;
  calls: { specs: ContainerSpec[]; options: (RunOptions | undefined)[] };
} {
  const calls = { specs: [] as ContainerSpec[], options: [] as (RunOptions | undefined)[] };
  const client: TestClient = {
    async run(spec: ContainerSpec, opts?: RunOptions) {
      calls.specs.push(spec);
      calls.options.push(opts);
      if (outcome.error !== undefined) return err(outcome.error);
      const ran: ContainerRun = {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? [],
        stderr: outcome.stderr ?? [],
        durationMs: outcome.durationMs ?? 42,
      };
      return ok(ran);
    },
  };
  return { client, calls };
}

const REPO = '/staged/c';

/** bun's summary output. */
const BUN_PASS = [' 12 pass', ' 0 fail', ' 1 skip'];
const BUN_FAIL = [
  ' 3 pass',
  ' 2 fail',
  '(fail) adds numbers [0.12ms]',
  '(fail) subtracts [0.05ms]',
];

describe('P-172 runTests', () => {
  it('reports passing suite', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0, stdout: BUN_PASS });
    const result = await runTests('node', REPO, {}, client);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pass).toBe(true);
      expect(result.value.passed).toBe(12);
      expect(result.value.failed).toBe(0);
      expect(result.value.skipped).toBe(1);
      expect(result.value.failures).toEqual([]);
      expect(result.value.command).toBe('bun test');
      expect(result.value.exitCode).toBe(0);
      expect(result.value.durationMs).toBe(42);
    }
    // Reads the staged repo from /workspace and runs there.
    expect(calls.specs[0]).toMatchObject({
      image: 'oven/bun:1.1',
      workingDir: WORKSPACE_MOUNT,
      bindMounts: [{ host: REPO, container: WORKSPACE_MOUNT }],
      cmd: ['bun', 'test'],
    });
  });

  it('reports failing suite with failures', async () => {
    const { client } = makeFakeClient({ exitCode: 1, stdout: BUN_FAIL });
    const result = await runTests('node', REPO, {}, client);

    // A red suite is a RESULT the pipeline reports, not an error.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pass).toBe(false);
      expect(result.value.passed).toBe(3);
      expect(result.value.failed).toBe(2);
      expect(result.value.failures.map(f => f.name)).toEqual(['adds numbers', 'subtracts']);
      expect(result.value.exitCode).toBe(1);
    }

    // python: `FAILED path::test - message` lines give name AND file.
    const py = makeFakeClient({
      exitCode: 1,
      stdout: [
        'FAILED tests/test_a.py::test_one - AssertionError: nope',
        '1 failed, 2 passed, 1 skipped',
      ],
    });
    const pyResult = await runTests('python', REPO, {}, py.client);
    expect(pyResult.isOk() && pyResult.value.failed).toBe(1);
    if (pyResult.isOk()) {
      expect(pyResult.value.passed).toBe(2);
      expect(pyResult.value.skipped).toBe(1);
      expect(pyResult.value.failures[0]).toEqual({
        name: 'test_one',
        message: 'AssertionError: nope',
        file: 'tests/test_a.py',
      });
    }

    // rust: the summary + `---- name stdout ----` blocks.
    const rust = makeFakeClient({
      exitCode: 101,
      stdout: [
        '---- my_test stdout ----',
        'panicked at src/lib.rs:3: assertion failed',
        'test result: FAILED. 1 passed; 1 failed; 0 ignored;',
      ],
    });
    const rustResult = await runTests('rust', REPO, {}, rust.client);
    if (rustResult.isOk()) {
      expect(rustResult.value.passed).toBe(1);
      expect(rustResult.value.failed).toBe(1);
      expect(rustResult.value.failures[0]?.name).toBe('my_test');
      expect(rustResult.value.failures[0]?.message).toContain('panicked at src/lib.rs:3');
    }

    // go: only failures are enumerated; the exit code carries the verdict.
    const go = makeFakeClient({ exitCode: 1, stdout: ['--- FAIL: TestA (0.00s)', 'FAIL'] });
    const goResult = await runTests('go', REPO, {}, go.client);
    if (goResult.isOk()) {
      expect(goResult.value.pass).toBe(false);
      expect(goResult.value.failures.map(f => f.name)).toEqual(['TestA']);
    }
  });

  it('falls back to exit code', async () => {
    // Unparseable output but exit 0 → trust the exit code (phase step 3).
    const { client } = makeFakeClient({ exitCode: 0, stdout: ['??? not a summary ???'] });
    const result = await runTests('python', REPO, {}, client);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.pass).toBe(true);
      expect(result.value.passed).toBe(0);
      expect(result.value.failed).toBe(0);
      expect(result.value.failures).toEqual([]);
    }

    // …and a non-zero exit with no parseable counts is still a red verdict.
    const red = makeFakeClient({ exitCode: 2, stdout: ['chaos'] });
    const redResult = await runTests('python', REPO, {}, red.client);
    expect(redResult.isOk() && redResult.value.pass).toBe(false);
  });

  it('errors on infra', async () => {
    const { client } = makeFakeClient({
      error: { code: 'SANDBOX_UNAVAILABLE', message: 'no backend' },
    });
    const failed = await runTests('rust', REPO, {}, client);
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.code).toBe('SANDBOX_UNAVAILABLE');

    // A blank repoPath is a caller bug, not a verdict.
    const blank = await runTests('go', '  ', {}, client);
    expect(blank.isErr()).toBe(true);
    if (blank.isErr()) expect(blank.error.code).toBe('CONFIG_ERROR');
  });

  it('selects command per eco', async () => {
    const { client } = makeFakeClient({ exitCode: 0 });
    const node = await runTests('node', REPO, {}, client);
    const python = await runTests('python', REPO, {}, client);
    const rust = await runTests('rust', REPO, {}, client);
    const go = await runTests('go', REPO, {}, client);
    expect(node.isOk() && node.value.command).toBe('bun test');
    expect(python.isOk() && python.value.command).toBe('pytest -q');
    expect(rust.isOk() && rust.value.command).toBe('cargo test --release');
    expect(go.isOk() && go.value.command).toBe('go test ./...');
    expect(TEST_COMMANDS.python).toEqual(['pytest', '-q']);
  });

  it('honors offline', async () => {
    const { client, calls } = makeFakeClient({ exitCode: 0 });
    await runTests('node', REPO, { networkAllowed: false, buildoutDir: '/out' }, client);
    expect(calls.specs[0]?.networkDisabled).toBe(true);
    expect(calls.specs[0]?.bindMounts).toEqual([
      { host: REPO, container: WORKSPACE_MOUNT },
      { host: '/out', container: '/buildout' },
    ]);
    // Network allowed by default, and no buildout mount unless asked for.
    await runTests('node', REPO, {}, client);
    expect(calls.specs[1]?.networkDisabled).toBeUndefined();
    expect(calls.specs[1]?.bindMounts).toHaveLength(1);
  });

  it('parses JUnit XML and bounds what it reports', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<testsuites>',
      '<testsuite name="suite" tests="3" failures="1" errors="0" skipped="1">',
      '<testcase name="ok_test" classname="src/util.test.ts"/>',
      '<testcase name="skip_test" classname="src/util.test.ts"><skipped/></testcase>',
      '<testcase name="bad_test" classname="src/util.test.ts">',
      '<failure message="expected 1 to be 2">stack trace</failure>',
      '</testcase>',
      '</testsuite>',
      '</testsuites>',
    ].join('\n');
    expect(looksLikeJunit(xml)).toBe(true);
    const parsed = parseJunitXml(xml);
    expect(parsed).toBeDefined();
    if (parsed !== undefined) {
      expect(parsed.passed).toBe(1);
      expect(parsed.failed).toBe(1);
      expect(parsed.skipped).toBe(1);
      expect(parsed.failures).toEqual([
        {
          name: 'src/util.test.ts :: bad_test',
          message: 'expected 1 to be 2',
          file: 'src/util.test.ts',
        },
      ]);
    }
    // XML is honoured end-to-end, and malformed XML falls through to the text
    // path rather than reporting zeros.
    expect(parseTestOutput('node', xml.split('\n'))).toMatchObject({ passed: 1, failed: 1 });
    expect(looksLikeJunit('12 pass')).toBe(false);
    expect(parseJunitXml('<testsuites></testsuites>')).toBeUndefined();

    // The failure list is capped.
    const many = ['<testsuite tests="90" failures="90">'];
    for (let i = 0; i < 90; i++) {
      many.push(`<testcase name="t${i}"><failure message="m"/></testcase>`);
    }
    many.push('</testsuite>');
    const capped = parseTestOutput('node', many, 5);
    expect(capped.failures).toHaveLength(5);
    expect(MAX_TEST_FAILURES).toBeGreaterThan(5);
  });

  it('bounds the log lines and forwards timeout/env', async () => {
    const many = Array.from({ length: 800 }, (_, i) => `line ${i}`);
    const { client, calls } = makeFakeClient({ exitCode: 0, stdout: many });
    const result = await runTests('node', REPO, { timeoutMs: 99, env: { CI: '1' } }, client);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.logs.stdout).toHaveLength(MAX_BUILD_LOG_LINES);
      expect(result.value.logs.stdout.at(-1)).toBe('line 799');
    }
    expect(calls.options[0]?.timeoutMs).toBe(99);
    expect(calls.specs[0]?.env).toEqual({ CI: '1' });
  });
});

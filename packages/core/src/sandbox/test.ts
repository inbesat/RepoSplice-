// P-172 — Sandbox: run tests.
//
// Merged C must not only build (P-171) but pass its own suite. `runTests` runs
// the ecosystem's test command in a sandbox container and returns a STRUCTURED
// result — counts and a bounded failure list — because two consumers need more
// than a boolean: the pipeline gate (finalise C) and flaky detection (P-176),
// and `TestResult.failures[].file` is what ties a red test back to a source
// file for provenance (P-181, per the handoff).
//
// Verdict semantics match P-171: a red suite is `ok(pass:false)` — the loop
// iterates on it — and only an infrastructure failure (container error, a bad
// repoPath) is a typed `err`.
//
// REPORTERS — measured, not assumed (ADR-045). None of the four runners emits a
// machine-readable report on STDOUT:
//   - `bun test --reporter=junit` REQUIRES `--reporter-outfile` (verified via
//     `bun test --help`), so it writes a file;
//   - `pytest --junit-xml` also writes a file;
//   - `cargo test --format json` needs nightly;
//   - `go test -json` exists but was not verifiable here (go is not installed).
// So the counts come from each runner's own summary line, and the JUnit parser
// below handles output that IS XML — which is what P-173's artifact capture
// will make reachable when a reporter file is lifted out and can be fed in.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { imageFor } from './images.js';
import { WORKSPACE_MOUNT, boundLogLines, type BuildClient } from './build.js';
import type { ContainerSpec, RunOptions } from './client.js';
import type { Ecosystem } from '../deps/index.js';

/** The container seam is the same one P-171 uses. */
export type TestClient = BuildClient;

/** Default wall-clock budget for one test run. */
export const DEFAULT_TEST_TIMEOUT_MS = 900_000;

/** How many failures are reported (the rest would not fit a UI or a log). */
export const MAX_TEST_FAILURES = 50;

/** The test command per ecosystem (phase step 2). */
export const TEST_COMMANDS: Readonly<Record<Ecosystem, string[]>> = {
  node: ['bun', 'test'],
  python: ['pytest', '-q'],
  rust: ['cargo', 'test', '--release'],
  go: ['go', 'test', './...'],
};

/** One failing test. */
export interface TestFailure {
  name: string;
  message: string;
  /** Source file, when the runner reported one (ties to P-181 provenance). */
  file?: string;
}

/** The structured verdict (phase step 1). */
export interface TestResult {
  pass: boolean;
  command: string;
  exitCode: number;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
  logs: { stdout: string[]; stderr: string[] };
}

/** Options for {@link runTests}. */
export interface RunTestsOptions {
  /** The image ref to run. Defaults to {@link imageFor}`(ecosystem)`. */
  image?: string;
  /** Whether the container may reach the network. Default `true`. */
  networkAllowed?: boolean;
  /** Host dir mounted writable at `/buildout` (test artifacts). */
  buildoutDir?: string;
  /** Extra environment entries. */
  env?: Record<string, string>;
  /** Wall-clock budget. */
  timeoutMs?: number;
  /** Abort signal, forwarded to the container run. */
  signal?: AbortSignal;
  /** Cap on reported failures. Default {@link MAX_TEST_FAILURES}. */
  maxFailures?: number;
}

/** Counts + failures extracted from a runner's output. */
export interface ParsedTestCounts {
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Read capture group `index` as a finite number, or 0. */
function groupNumber(match: RegExpExecArray | null, index: number): number {
  const raw = match?.[index];
  if (raw === undefined) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const newline = trimmed.indexOf('\n');
  return newline === -1 ? trimmed : trimmed.slice(0, newline);
}

/** Does this output look like a JUnit XML report? */
export function looksLikeJunit(text: string): boolean {
  return /<testsuite[\s>]/.test(text) || text.trimStart().startsWith('<?xml');
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return match?.[1];
}

/**
 * Parse a JUnit XML report.
 *
 * Returns `undefined` when the document has no `<testsuite>` header to read —
 * the caller then falls back to the text summary rather than reporting zeros.
 * Counts come from the suite attributes; `passed` is the remainder, so it can
 * never exceed `tests`.
 */
export function parseJunitXml(
  text: string,
  maxFailures: number = MAX_TEST_FAILURES
): ParsedTestCounts | undefined {
  const suite = /<testsuite\b[^>]*>/.exec(text);
  if (suite === null) return undefined;
  const tag = suite[0];
  const tests = Number(attribute(tag, 'tests') ?? '0');
  const failed =
    Number(attribute(tag, 'failures') ?? '0') + Number(attribute(tag, 'errors') ?? '0');
  const skipped = Number(attribute(tag, 'skipped') ?? '0');
  const passed = Math.max(0, (Number.isFinite(tests) ? tests : 0) - failed - skipped);

  const failures: TestFailure[] = [];
  const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match: RegExpExecArray | null;
  while ((match = caseRe.exec(text)) !== null && failures.length < maxFailures) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const failure = /<(?:failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/.exec(
      body
    );
    if (failure === null) continue;
    const name = attribute(attrs, 'name') ?? '(unnamed)';
    const classname = attribute(attrs, 'classname');
    const message = attribute(failure[1] ?? '', 'message') ?? firstLine(failure[2] ?? '');
    failures.push({
      name: classname !== undefined && classname !== '' ? `${classname} :: ${name}` : name,
      message,
      ...(classname !== undefined && classname !== '' ? { file: classname } : {}),
    });
  }
  return { passed, failed, skipped, failures };
}

/** The per-ecosystem summary-line counts. */
function parseSummary(ecosystem: Ecosystem, text: string): ParsedTestCounts {
  const failures = parseTextFailures(ecosystem, text);
  switch (ecosystem) {
    case 'node':
      return {
        passed: groupNumber(/(\d+)\s+pass\b/i.exec(text), 1),
        failed: groupNumber(/(\d+)\s+fail\b/i.exec(text), 1),
        skipped: groupNumber(/(\d+)\s+skip\b/i.exec(text), 1),
        failures,
      };
    case 'python':
      return {
        passed: groupNumber(/(\d+)\s+passed\b/i.exec(text), 1),
        failed: groupNumber(/(\d+)\s+failed\b/i.exec(text), 1),
        skipped: groupNumber(/(\d+)\s+skipped\b/i.exec(text), 1),
        failures,
      };
    case 'rust': {
      const summary = /test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/.exec(
        text
      );
      return {
        passed: groupNumber(summary, 1),
        failed: groupNumber(summary, 2),
        skipped: groupNumber(summary, 3),
        failures,
      };
    }
    case 'go':
      // `go test` enumerates only failures on stdout; passing packages print
      // `ok <pkg>`. Counting packages as tests would overstate, so the counts
      // stay 0 and the exit code carries the verdict (step 3).
      return { passed: 0, failed: failures.length, skipped: 0, failures };
  }
}

/** Failure lines each runner prints, parsed best-effort. */
function parseTextFailures(ecosystem: Ecosystem, text: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const push = (failure: TestFailure): void => {
    if (failures.length < MAX_TEST_FAILURES) failures.push(failure);
  };
  switch (ecosystem) {
    case 'node': {
      // bun prints `(fail) name [0.12ms]` for each failing test.
      const re = /^\(fail\)\s+(.+?)(?:\s+\[[\d.]+ms\])?\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push({ name: m[1] ?? '(unnamed)', message: '' });
      return failures;
    }
    case 'python': {
      // pytest -q prints `FAILED path::test - AssertionError: msg`.
      const re = /^FAILED\s+(\S+?)(?:\s+-\s+(.*))?$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const target = m[1] ?? '';
        const sep = target.indexOf('::');
        const file = sep === -1 ? undefined : target.slice(0, sep);
        const name = sep === -1 ? target : target.slice(sep + 2);
        push({
          name,
          message: m[2] ?? '',
          ...(file !== undefined ? { file } : {}),
        });
      }
      return failures;
    }
    case 'rust': {
      // `---- name stdout ----` followed by the panic/assertion message.
      const re = /^----\s+(\S+)\s+stdout\s+----\n([\s\S]*?)(?=\n\n|\n----|$)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        push({ name: m[1] ?? '(unnamed)', message: firstLine(m[2] ?? '') });
      }
      return failures;
    }
    case 'go': {
      const re = /^--- FAIL:\s+(\S+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push({ name: m[1] ?? '(unnamed)', message: '' });
      return failures;
    }
  }
}

/**
 * Parse a runner's output into counts + failures.
 *
 * JUnit XML is honoured when present; otherwise each ecosystem's own summary
 * line is read. Everything is best-effort: an unparseable suite still reports
 * its exit code, which is what the verdict uses (phase step 3).
 */
export function parseTestOutput(
  ecosystem: Ecosystem,
  stdout: readonly string[],
  maxFailures: number = MAX_TEST_FAILURES
): ParsedTestCounts {
  const text = stdout.join('\n');
  if (looksLikeJunit(text)) {
    const junit = parseJunitXml(text, maxFailures);
    if (junit !== undefined) {
      return { ...junit, failures: junit.failures.slice(0, maxFailures) };
    }
  }
  const parsed = parseSummary(ecosystem, text);
  return { ...parsed, failures: parsed.failures.slice(0, maxFailures) };
}

// ---------------------------------------------------------------------------
// runTests
// ---------------------------------------------------------------------------

/**
 * Run the staged repo's test suite inside the sandbox and report the verdict.
 *
 * `ok(TestResult{pass:false})` IS a result — a red suite is what the pipeline
 * reports and P-176 analyses. Only infrastructure failures return `err`.
 */
export async function runTests(
  ecosystem: Ecosystem,
  repoPath: string,
  opts: RunTestsOptions,
  client: TestClient
): Promise<Result<TestResult, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'runTests: repoPath is required',
    });
  }

  const command = TEST_COMMANDS[ecosystem];
  const bindMounts: ContainerSpec['bindMounts'] = [{ host: repoPath, container: WORKSPACE_MOUNT }];
  if (opts.buildoutDir !== undefined && opts.buildoutDir.trim() !== '') {
    bindMounts.push({ host: opts.buildoutDir, container: '/buildout' });
  }

  const spec: ContainerSpec = {
    image: opts.image ?? imageFor(ecosystem),
    workingDir: WORKSPACE_MOUNT,
    bindMounts,
    cmd: command,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.networkAllowed === false ? { networkDisabled: true } : {}),
  };

  const runOptions: RunOptions = {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  };
  const ran = await client.run(spec, runOptions);
  // The only `err` this phase produces.
  if (ran.isErr()) return err(ran.error);

  const outcome = ran.value;
  const pass = outcome.exitCode === 0;
  const parsed = parseTestOutput(ecosystem, outcome.stdout, opts.maxFailures ?? MAX_TEST_FAILURES);

  return ok({
    pass,
    command: command.join(' '),
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: parsed.failures,
    logs: {
      stdout: boundLogLines(outcome.stdout),
      stderr: boundLogLines(outcome.stderr),
    },
  });
}

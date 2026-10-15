// P-175 — GitHub Actions fallback tests.
//
// The Octokit client is a fake (`SandboxTriggerClient`), so nothing reaches
// GitHub: the tests assert the DECISION, the template rendering, and that the
// GH verdict is shaped into the same `BuildResult`/`TestResult` the Docker path
// returns (that parity is the phase handoff's requirement).
//
// The required scenarios that live here:
//
//   it('selects backend')                it('runs via github actions')
//   it('parses gh logs to BuildResult')  it('gates on auth')

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err } from 'neverthrow';
import type { SandboxTriggerClient } from '../github/sandboxTrigger.js';
import { BUILD_COMMANDS } from './build.js';
import { TEST_COMMANDS } from './test.js';
import {
  DEFAULT_WORKFLOW_FILE,
  WORKFLOW_PLACEHOLDERS,
  fallbackSelection,
  renderWorkflow,
  runViaGitHubActions,
  type SelectionSource,
} from './fallback.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const TEMPLATE = join(REPO_ROOT, 'templates', 'github-build.yml');

/** A fake Octokit seam: records the dispatch and answers a scripted run. */
function makeFakeTriggerClient(
  verdict: { conclusion?: string | null; status?: string; runId?: number } = {}
): {
  client: SandboxTriggerClient;
  dispatched: { owner: string; repo: string; workflowId: string; ref: string }[];
} {
  const dispatched: { owner: string; repo: string; workflowId: string; ref: string }[] = [];
  // The exact run shape P-095's reader requires: 40-hex `head_sha`, a
  // non-blank `html_url`, a string|null `conclusion`.
  const run = {
    id: verdict.runId ?? 42,
    head_sha: SHA,
    head_branch: 'main',
    status: verdict.status ?? 'completed',
    conclusion: verdict.conclusion ?? 'success',
    html_url: 'https://example.test/run/42',
  };
  const client: SandboxTriggerClient = {
    rest: {
      repos: {
        createDispatchEvent: async () => ({ data: {}, headers: {}, status: 204 }),
      },
      actions: {
        createWorkflowDispatch: async args => {
          dispatched.push({
            owner: args.owner,
            repo: args.repo,
            workflowId: args.workflow_id,
            ref: args.ref,
          });
          return { data: {}, headers: {}, status: 204 };
        },
        getWorkflowRun: async () => ({ data: run, headers: {}, status: 200 }),
        listWorkflowRunsForRepo: async () => ({
          data: { workflow_runs: [run] },
          headers: {},
          status: 200,
        }),
      },
    },
  };
  return { client, dispatched };
}

const SHA = 'a'.repeat(40);
const GITHUB_OPTS = {
  owner: 'acme',
  repo: 'child-c',
  sha: SHA,
  ref: 'main',
  jobId: 'job-1',
  timeoutMs: 1_000,
};

describe('P-175 fallback', () => {
  it('selects backend', () => {
    // auto prefers Docker, falls back to a usable GH path.
    expect(
      fallbackSelection({ mode: 'auto', dockerAvailable: true, hasAuth: true, ciConfigured: true })
    ).toBe('docker');
    expect(
      fallbackSelection({ mode: 'auto', dockerAvailable: false, hasAuth: true, ciConfigured: true })
    ).toBe('github');
    expect(fallbackSelection({ mode: 'auto', dockerAvailable: false })).toBe('unavailable');

    // Forced docker with no daemon still uses a working GH path…
    expect(
      fallbackSelection({
        mode: 'docker',
        dockerAvailable: false,
        hasAuth: true,
        ciConfigured: true,
      })
    ).toBe('github');
    // …and is only unavailable when there is none.
    expect(fallbackSelection({ mode: 'docker', dockerAvailable: false, hasAuth: true })).toBe(
      'unavailable'
    );

    // Forced github ignores Docker entirely.
    expect(
      fallbackSelection({
        mode: 'github',
        dockerAvailable: true,
        hasAuth: true,
        ciConfigured: true,
      })
    ).toBe('github');
    expect(
      fallbackSelection({
        mode: 'github',
        dockerAvailable: true,
        hasAuth: false,
        ciConfigured: true,
      })
    ).toBe('unavailable');

    // The P-009 `backend` field is read when `mode` is unset.
    const fromBackend: SelectionSource = {
      backend: 'github-actions',
      hasAuth: true,
      ciConfigured: true,
    };
    expect(fallbackSelection(fromBackend)).toBe('github');
    expect(fallbackSelection({ backend: 'docker', dockerAvailable: true })).toBe('docker');
    // Nothing configured at all → inaccessible.
    expect(fallbackSelection()).toBe('unavailable');
  });

  it('runs via github actions', async () => {
    const { client, dispatched } = makeFakeTriggerClient({ conclusion: 'success' });
    const result = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      client,
    });
    expect(result.isOk()).toBe(true);
    // A workflow dispatch was issued against the configured workflow file.
    expect(dispatched).toEqual([
      { owner: 'acme', repo: 'child-c', workflowId: DEFAULT_WORKFLOW_FILE, ref: 'main' },
    ]);

    // A run that never completed is a timeout, NOT a fabricated verdict.
    const unfinished = makeFakeTriggerClient({ status: 'in_progress', conclusion: null });
    const timedOut = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      client: unfinished.client,
    });
    expect(timedOut.isErr()).toBe(true);
    if (timedOut.isErr()) expect(timedOut.error.code).toBe('SANDBOX_TIMEOUT');

    // A failing run still yields a verdict (not an error).
    const failed = makeFakeTriggerClient({ conclusion: 'failure' });
    const red = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      client: failed.client,
    });
    expect(red.isOk() && red.value.pass).toBe(false);

    // Missing wiring is a caller bug.
    const bad = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      ref: '  ',
      client,
    });
    expect(bad.isErr() && bad.error.code).toBe('CONFIG_ERROR');
  });

  it('parses gh logs to BuildResult', async () => {
    // Build path: the verdict's pass maps to pass/exitCode, logs come through.
    const { client } = makeFakeTriggerClient({ conclusion: 'success' });
    const built = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      client,
      fetchLogs: async () => ok('installing\nbuilding\nbuilt ok'),
    });
    expect(built.isOk()).toBe(true);
    if (built.isOk()) {
      expect(built.value.pass).toBe(true);
      expect(built.value.exitCode).toBe(0);
      expect(built.value.command).toBe(BUILD_COMMANDS.node.join(' '));
      expect(built.value.logs.stdout).toEqual(['installing', 'building', 'built ok']);
      expect(built.value.logs.stderr).toEqual([]);
    }

    // Test path: the SAME parser as the Docker backend (P-172), so counts and
    // failures mean the same thing on both.
    const testRun = await runViaGitHubActions('python', '/staged/c', 'test', {
      ...GITHUB_OPTS,
      client,
      fetchLogs: async () =>
        ok(
          [
            'FAILED tests/test_a.py::test_one - AssertionError: nope',
            '1 failed, 2 passed, 1 skipped',
          ].join('\n')
        ),
    });
    expect(testRun.isOk()).toBe(true);
    if (testRun.isOk()) {
      expect(testRun.value.command).toBe(TEST_COMMANDS.python.join(' '));
      const asTest = testRun.value as {
        passed: number;
        failed: number;
        skipped: number;
        failures: { name: string; file?: string }[];
      };
      expect(asTest.passed).toBe(2);
      expect(asTest.failed).toBe(1);
      expect(asTest.skipped).toBe(1);
      expect(asTest.failures[0]).toEqual({
        name: 'test_one',
        message: 'AssertionError: nope',
        file: 'tests/test_a.py',
      });
    }

    // A log fetch failure propagates rather than silently reporting no logs.
    const logFail = await runViaGitHubActions('node', '/staged/c', 'build', {
      ...GITHUB_OPTS,
      client,
      fetchLogs: async () => err({ code: 'GITHUB_API_ERROR', status: 500, message: 'logs gone' }),
    });
    expect(logFail.isErr()).toBe(true);
  });

  it('gates on auth', () => {
    // Without auth the GH path is never chosen, whatever Docker does.
    expect(
      fallbackSelection({
        mode: 'auto',
        dockerAvailable: false,
        hasAuth: false,
        ciConfigured: true,
      })
    ).toBe('unavailable');
    // …and without a configured workflow either.
    expect(fallbackSelection({ mode: 'auto', dockerAvailable: false, hasAuth: true })).toBe(
      'unavailable'
    );
  });

  it('renders the committed workflow template', async () => {
    const template = await readFile(TEMPLATE, 'utf8');
    const rendered = renderWorkflow(template, {
      jobId: 'job-9',
      ecosystem: 'go',
      timeoutMinutes: 25,
    });
    expect(rendered.isOk()).toBe(true);
    if (rendered.isOk()) {
      expect(rendered.value).toContain('go');
      expect(rendered.value).toContain('timeout-minutes: 25');
      expect(rendered.value).toContain('go mod download');
      expect(rendered.value).toContain(BUILD_COMMANDS.go.join(' '));
      expect(rendered.value).toContain(TEST_COMMANDS.go.join(' '));
      // No placeholder survives a successful render.
      for (const key of WORKFLOW_PLACEHOLDERS) expect(rendered.value).not.toContain(`{{${key}}}`);
    }

    // A missing value is a typed error, never a placeholder left in a
    // dispatched workflow.
    const broken = renderWorkflow(template, {
      jobId: '  ',
      ecosystem: 'node',
      timeoutMinutes: 5,
    });
    expect(broken.isErr()).toBe(true);
    if (broken.isErr()) expect(broken.error.code).toBe('CONFIG_ERROR');

    // Callers can override the ecosystem defaults (e.g. a pyproject workspace).
    const overridden = renderWorkflow(template, {
      jobId: 'j',
      ecosystem: 'python',
      timeoutMinutes: 5,
      install: 'uv sync',
    });
    expect(overridden.isOk() && overridden.value).toContain('uv sync');
  });
});

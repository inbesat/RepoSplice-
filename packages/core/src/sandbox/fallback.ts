// P-175 — Sandbox: GitHub Actions fallback.
//
// Docker is not always available (CI images without the daemon, sandboxed
// hosts, plain user machines). When it is not, verification runs on GitHub
// Actions instead, through the workflow P-100 already knows how to dispatch.
//
// Two things live here:
//
//   1. `fallbackSelection` — the pure decision (docker / github / unavailable)
//      from the configured mode, daemon reachability, and whether a GitHub
//      path is actually usable (auth AND a configured workflow).
//   2. `runViaGitHubActions` — dispatch, poll, pull logs, and shape the answer
//      into the SAME `BuildResult`/`TestResult` the Docker path returns, so no
//      downstream consumer (the agent tool, the UI, the pipeline) has to care
//      which backend ran (the phase handoff's requirement).
//
// Rendering is deliberately split: the template TEXT is an input, so the
// canonical workflow lives in one committed file (`templates/github-build.yml`)
// rather than being duplicated as a string constant that can drift. The
// production caller reads that file (its path comes from `config.ci.path`);
// tests pass the text directly.
//
// Latency: a GH fallback is minutes, not seconds — a queue wait plus a cold
// runner plus the ecosystem install. Callers should surface that; the poll
// budget is the caller's `timeoutMs`, and an unfinished run is
// `SANDBOX_TIMEOUT` rather than a fabricated verdict.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { triggerSandbox, monitorSandboxRun } from '../github/sandboxTrigger.js';
import type { SandboxTriggerClient } from '../github/sandboxTrigger.js';
import { parseTestOutput } from './test.js';
import { TEST_COMMANDS } from './test.js';
import { BUILD_COMMANDS } from './build.js';
import type { BuildResult } from './build.js';
import type { TestResult } from './test.js';
import type { Ecosystem } from '../deps/index.js';

/** The committed workflow's default path in the child repo. */
export const DEFAULT_WORKFLOW_FILE = '.github/workflows/stitch-sandbox.yml';

/** The placeholders `renderWorkflow` requires. */
export const WORKFLOW_PLACEHOLDERS = [
  'jobId',
  'ecosystem',
  'timeoutMinutes',
  'install',
  'build',
  'test',
] as const;

/** Which backend a run should use. */
export type BackendChoice = 'docker' | 'github' | 'unavailable';

/** What the selection needs. Every field is optional; absent means "unknown". */
export interface SelectionSource {
  /** `config.sandbox.mode` (P-175). Takes precedence when set. */
  mode?: 'auto' | 'docker' | 'github';
  /** `config.sandbox.backend` (P-009) — read when `mode` is unset. */
  backend?: 'docker' | 'github-actions';
  /** `config.ci.path` present — the GH path's flag. */
  ciConfigured?: boolean;
  /** Whether a Docker daemon answered (`SandboxClient.isAvailable`). */
  dockerAvailable?: boolean;
  /** Whether GitHub auth was resolved (P-088). */
  hasAuth?: boolean;
}

/** What rendering needs. */
export interface WorkflowValues {
  jobId: string;
  ecosystem: Ecosystem;
  timeoutMinutes: number;
  /** Overrides for the ecosystem's canonical commands (rare). */
  install?: string;
  build?: string;
  test?: string;
}

/** Options for {@link runViaGitHubActions}. */
export interface GitHubFallbackOptions {
  /** The Octokit-backed client (P-100's narrow seam). */
  client: SandboxTriggerClient;
  owner: string;
  repo: string;
  /** Commit under test (40 hex). */
  sha: string;
  /** Branch the workflow runs from (required by workflow dispatch). */
  ref: string;
  /** Correlates the run back to this job (P-239). */
  jobId: string;
  /** Workflow file in the repo. Default {@link DEFAULT_WORKFLOW_FILE}. */
  workflowFile?: string;
  /** Poll budget; an unfinished run is `SANDBOX_TIMEOUT`. */
  timeoutMs?: number;
  /** Branch scope for the run search (passed to P-095). */
  branch?: string;
  /**
   * Fetch a job's logs. Optional: without it the verdict still stands and the
   * logs come back empty rather than failing the run.
   */
  fetchLogs?: (jobId: string) => Promise<Result<string, StitchError>>;
}

/** The canonical install command per ecosystem (mirrors P-170's defaults). */
const DEFAULT_INSTALL: Readonly<Record<Ecosystem, string>> = {
  node: 'bun install',
  python: 'pip install -r requirements.txt',
  rust: 'cargo fetch',
  go: 'go mod download',
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Choose a backend.
 *
 * `auto` prefers Docker and falls back to GitHub. A FORCED choice still falls
 * back when the forced backend cannot run but a usable GitHub path exists —
 * the acceptance criterion says a forced `docker` with no daemon is only
 * `unavailable` when there is no GitHub path, because refusing to run when a
 * working backend is configured would be the wrong failure.
 */
export function fallbackSelection(source: SelectionSource = {}): BackendChoice {
  const mode =
    source.mode ??
    (source.backend === 'github-actions'
      ? 'github'
      : source.backend === 'docker'
        ? 'docker'
        : 'auto');
  const githubUsable = source.ciConfigured === true && source.hasAuth === true;
  const dockerUsable = source.dockerAvailable === true;

  switch (mode) {
    case 'docker':
      return dockerUsable ? 'docker' : githubUsable ? 'github' : 'unavailable';
    case 'github':
      return githubUsable ? 'github' : 'unavailable';
    case 'auto':
      return dockerUsable ? 'docker' : githubUsable ? 'github' : 'unavailable';
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Fill the workflow template's placeholders.
 *
 * Strict like P-141's prompt renderer: a missing value is a typed
 * `CONFIG_ERROR`, never a `{{placeholder}}` left in a dispatched workflow.
 */
export function renderWorkflow(
  template: string,
  values: WorkflowValues
): Result<string, StitchError> {
  const resolved: Record<string, string> = {
    jobId: values.jobId,
    ecosystem: values.ecosystem,
    timeoutMinutes: String(values.timeoutMinutes),
    install: values.install ?? DEFAULT_INSTALL[values.ecosystem],
    build: values.build ?? BUILD_COMMANDS[values.ecosystem].join(' '),
    test: values.test ?? TEST_COMMANDS[values.ecosystem].join(' '),
  };
  let rendered = template;
  for (const key of WORKFLOW_PLACEHOLDERS) {
    const value = resolved[key];
    if (value === undefined || value.trim() === '') {
      return err({
        code: 'CONFIG_ERROR',
        field: `workflow.${key}`,
        message: `workflow template is missing a value for {{${key}}}`,
      });
    }
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return ok(rendered);
}

// ---------------------------------------------------------------------------
// The GH run
// ---------------------------------------------------------------------------

/**
 * Run one verification step on GitHub Actions and shape the answer like the
 * Docker path's.
 *
 * Dispatch (P-100) → poll the run by SHA/job (P-095) → optional job logs →
 * `BuildResult` or `TestResult` built from the SAME parsers the Docker path
 * uses (P-172's `parseTestOutput`), so the two backends cannot drift.
 */
export async function runViaGitHubActions(
  ecosystem: Ecosystem,
  repoPath: string,
  action: 'build' | 'test',
  opts: GitHubFallbackOptions
): Promise<Result<BuildResult | TestResult, StitchError>> {
  void repoPath; // The workflow checks out the repo itself; kept for signature parity.
  if (opts.owner.trim() === '' || opts.repo.trim() === '' || opts.sha.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'owner',
      message: 'runViaGitHubActions: owner, repo and sha are required',
    });
  }
  if (opts.ref.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ref',
      message: 'runViaGitHubActions: ref is required (workflow dispatch needs a ref)',
    });
  }

  const dispatched = await triggerSandbox(opts.client, opts.owner, opts.repo, {
    sha: opts.sha,
    ecosystem,
    ref: opts.ref,
    jobId: opts.jobId,
    dispatch: 'workflow',
    workflow: opts.workflowFile ?? DEFAULT_WORKFLOW_FILE,
  });
  if (dispatched.isErr()) return err(dispatched.error);

  const startedAt = Date.now();
  const verdict = await monitorSandboxRun(opts.client, opts.owner, opts.repo, opts.sha, {
    jobId: opts.jobId,
    ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
  });
  if (verdict.isErr()) return err(verdict.error);
  const durationMs = Date.now() - startedAt;

  // An unfinished run is not a verdict: never fabricate pass/fail for it.
  if (!verdict.value.completed) {
    return err({
      code: 'SANDBOX_TIMEOUT',
      timeoutMs: opts.timeoutMs ?? 0,
      message: `GitHub Actions run ${verdict.value.runId} did not complete within the poll budget`,
    });
  }

  let logs: string[] = [];
  if (opts.fetchLogs !== undefined) {
    const fetched = await opts.fetchLogs(String(verdict.value.runId));
    if (fetched.isErr()) return err(fetched.error);
    logs = fetched.value.split('\n').filter(line => line !== '');
  }

  const command =
    action === 'build' ? BUILD_COMMANDS[ecosystem].join(' ') : TEST_COMMANDS[ecosystem].join(' ');
  const pass = verdict.value.pass;
  const exitCode = pass ? 0 : 1;

  if (action === 'build') {
    const result: BuildResult = {
      pass,
      command,
      exitCode,
      durationMs,
      logs: { stdout: logs, stderr: [] },
    };
    return ok(result);
  }

  // The test path reuses P-172's parser, so counts and failures mean the same
  // thing whichever backend produced the lines.
  const parsed = parseTestOutput(ecosystem, logs);
  const result: TestResult = {
    pass,
    command,
    exitCode,
    durationMs,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: parsed.failures,
    logs: { stdout: logs, stderr: [] },
  };
  return ok(result);
}

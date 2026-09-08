// stitch doctor core (P-068): deterministic system-dependency checks.
//
// `stitch doctor` is the first thing a user runs (P-195) and gates setup:
// it verifies git >= MIN_GIT_VERSION (P-065), git-filter-repo (P-066/P-070),
// the Docker daemon (P-029/P-067), and — only when configured — ollama
// local AI (P-301) plus GitHub token presence (P-206).
//
// Shape notes (all deliberate, all spec-driven):
// - A check NEVER throws and NEVER errs for a missing/down dependency:
//   absence is normal, hintable data, so it comes back as
//   ok({ pass: false, detail, fix }). Err is reserved for a broken probe
//   itself, which runDoctor degrades to a failed outcome (same rule as
//   P-031 mapLimit: one bad item cannot kill the batch).
// - Checks run concurrently under a p-limit cap (P-031) but the report
//   preserves input order, so output is deterministic run to run.
// - No new StitchError codes: every failure below reuses codes the probes
//   already produce (CONFIG_ERROR/INTERNAL/AI_PROVIDER_ERROR/...).
// - No default ollama network probe: the real local-AI client is P-301's
//   job, so makeOllamaCheck takes the probe as a seam (same pattern as
//   P-065 localGitVersion and P-067 checkDockerDaemon). Optionals join the
//   list only when configured.
// - The DoctorReport JSON shape ({ ok, checks: [{ id, label, critical,
//   pass, detail, fix? }] }) is stable and minimal; the CLI-wide --json
//   envelope is P-194's to extend, not this module's to guess.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { MIN_GIT_VERSION, isGitVersionSupported, localGitVersion } from '../git/version.js';
import { checkFilterRepoStatus } from '../git/filterRepo.js';
import { createDockerClient, pingDocker, type DockerReachability } from '../sandbox/docker.js';
import { checkDockerDaemon } from '../sandbox/dockerProbe.js';
import { mapLimit } from '../util/limit.js';

const execFileAsync = promisify(execFile);

/** Cap for concurrent probes (and the dockerode ping timeout below). */
const DOCTOR_CONCURRENCY = 4;
const DOCKER_PING_TIMEOUT_MS = 10_000;

/** One check's verdict: pass/fail data plus a fix hint when failing. */
export interface CheckResult {
  pass: boolean;
  detail: string;
  fix?: string;
}

/**
 * A named, ordered dependency check. `critical` decides the report: any
 * failing critical check flips `DoctorReport.ok` (and the CLI exit code);
 * non-critical failures (docker fallback, optionals) are informational.
 */
export interface DependencyCheck {
  id: string;
  label: string;
  critical: boolean;
  check: () => Promise<Result<CheckResult, StitchError>>;
}

/** A check's verdict with its identity attached, in run order. */
export interface CheckOutcome {
  id: string;
  label: string;
  critical: boolean;
  pass: boolean;
  detail: string;
  fix?: string;
}

/**
 * The aggregated report. `ok` is true only when every CRITICAL check
 * passed. Serializes stably to the `stitch doctor --json` shape.
 */
export interface DoctorReport {
  ok: boolean;
  checks: CheckOutcome[];
}

/** Runner seam: `(args) => stdout`, e.g. execFile('git', args). */
export type ProcessRunner = (args: readonly string[]) => Promise<string>;

/** Default runner: `git` resolved via PATH. Throws on missing binary. */
async function defaultGitRun(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args]);
  return stdout;
}

/** Default runner: `git-filter-repo` resolved via PATH. */
async function defaultFilterRepoRun(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git-filter-repo', [...args]);
  return stdout;
}

/** Default daemon ping: dockerode over the platform socket, 10s timeout. */
async function defaultDockerPing(): Promise<DockerReachability> {
  const created = createDockerClient({ timeoutMs: DOCKER_PING_TIMEOUT_MS });
  if (created.isErr()) {
    return { reachable: false, reason: describeError(created.error) };
  }
  const probed = await pingDocker(created.value.docker);
  if (probed.isErr()) {
    return { reachable: false, reason: describeError(probed.error) };
  }
  return probed.value;
}

/** Default engine-version read: `docker version` server side. */
async function defaultDockerReadVersion(): Promise<string> {
  const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}']);
  return stdout;
}

/** Default token read: standard env names only; the value never leaves. */
function defaultReadGitHubToken(): string | undefined {
  return process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
}

/**
 * Render any StitchError variant to one deterministic line. Exhaustive over
 * the code union (no default): adding a code forces a rendering decision
 * here at compile time. Discriminant narrowing follows the repo precedent
 * (treeSitter.ts / circular.ts / scan.ts).
 */
function describeError(error: StitchError): string {
  switch (error.code) {
    case 'GIT_ERROR':
    case 'GITHUB_API_ERROR':
    case 'DOCKER_ERROR':
    case 'AI_PROVIDER_ERROR':
    case 'CONFIG_ERROR':
    case 'INTERNAL':
    case 'AUTH_ERROR':
    case 'COMPLIANCE_VIOLATION':
      return `${error.code}: ${error.message}`;
    case 'USER_CANCELLED':
      return `${error.code}: ${error.reason}`;
    case 'LICENSE_VIOLATION':
      return `${error.code}: ${error.license} (${error.policy})`;
    case 'DEPENDENCY_CONFLICT':
      return `${error.code}: ${error.details}`;
    case 'SANDBOX_FAILED':
      return `${error.code}: ${error.step}: ${error.logs}`;
    case 'COST_LIMIT':
      return `${error.code}: ${error.provider} spent $${error.spentUsd} of $${error.limitUsd}`;
    case 'UNKNOWN_LICENSE':
      return `${error.code}: ${error.id}`;
  }
}

/** Degrade a broken probe to a failed outcome (never a throw). */
function failedOutcome(check: DependencyCheck, detail: string): CheckOutcome {
  return { id: check.id, label: check.label, critical: check.critical, pass: false, detail };
}

/** Run one check: err and throw both become failed outcomes with context. */
async function runOneCheck(check: DependencyCheck): Promise<CheckOutcome> {
  const base = { id: check.id, label: check.label, critical: check.critical };
  try {
    const result = await check.check();
    if (result.isErr()) {
      return { ...base, pass: false, detail: `check failed: ${describeError(result.error)}` };
    }
    return {
      ...base,
      pass: result.value.pass,
      detail: result.value.detail,
      ...(result.value.fix !== undefined ? { fix: result.value.fix } : {}),
    };
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ...base, pass: false, detail: `check threw: ${detail}` };
  }
}

/**
 * git >= MIN_GIT_VERSION (P-065). Missing binary, unparsable output, and a
 * below-floor version are all ok({ pass: false }) with the floor named —
 * the floor constant is read, never restated, so it cannot drift.
 */
export function makeGitCheck(run: ProcessRunner = defaultGitRun): DependencyCheck {
  const floorDoc = `Install git >= ${MIN_GIT_VERSION} (see docs/system/git-version.md)`;
  return {
    id: 'git',
    label: `git >= ${MIN_GIT_VERSION}`,
    critical: true,
    check: async () => {
      const version = await localGitVersion(run);
      if (version === null) {
        return ok({
          pass: false,
          detail: 'git not found or its version output was unrecognized',
          fix: floorDoc,
        });
      }
      const supported = isGitVersionSupported(version);
      if (supported.isErr()) {
        return ok({
          pass: false,
          detail: `could not verify git version: ${describeError(supported.error)}`,
          fix: floorDoc,
        });
      }
      if (!supported.value) {
        return ok({
          pass: false,
          detail: `git ${version} is below the ${MIN_GIT_VERSION} floor`,
          fix: `Upgrade git to >= ${MIN_GIT_VERSION} (see docs/system/git-version.md)`,
        });
      }
      return ok({ pass: true, detail: `git ${version} meets the >= ${MIN_GIT_VERSION} floor` });
    },
  };
}

/**
 * git-filter-repo presence (P-066/P-070). Presence is the gate (upstream
 * reports a revision hash, not semver); the raw string rides along for
 * display. Critical: history rewrite cannot run without it.
 */
export function makeFilterRepoCheck(run: ProcessRunner = defaultFilterRepoRun): DependencyCheck {
  return {
    id: 'git-filter-repo',
    label: 'git-filter-repo',
    critical: true,
    check: async () => {
      const status = await checkFilterRepoStatus(run);
      if (status.isErr()) return err(status.error);
      if (!status.value.available) {
        return ok({
          pass: false,
          detail: 'git-filter-repo not found on PATH',
          fix:
            status.value.fix ??
            'Install git-filter-repo (pip install git-filter-repo; see docs/system/git-filter-repo.md)',
        });
      }
      const revision = status.value.version ?? 'unknown revision';
      return ok({ pass: true, detail: `git-filter-repo ${revision} available` });
    },
  };
}

/** Seams for the daemon probe; defaults hit the real local daemon. */
export interface DockerCheckSeams {
  ping?: () => Promise<DockerReachability>;
  readVersion?: () => Promise<string>;
}

/**
 * Docker daemon reachability + engine version (P-029/P-067).
 * NON-critical: without a daemon stitch falls back to GH Actions (P-178),
 * so a down daemon must never gate setup.
 */
export function makeDockerCheck(seams: DockerCheckSeams = {}): DependencyCheck {
  const ping = seams.ping ?? defaultDockerPing;
  const readVersion = seams.readVersion ?? defaultDockerReadVersion;
  return {
    id: 'docker',
    label: 'docker daemon',
    critical: false,
    check: async () => {
      const status = await checkDockerDaemon(ping, readVersion);
      if (status.isErr()) return err(status.error);
      if (!status.value.reachable) {
        return ok({
          pass: false,
          detail: 'docker daemon unreachable',
          ...(status.value.fix !== undefined ? { fix: status.value.fix } : {}),
        });
      }
      const engine = status.value.engineVersion ?? 'unknown version';
      return ok({ pass: true, detail: `docker daemon reachable (engine ${engine})` });
    },
  };
}

/**
 * Minimal ollama liveness shape. The real local-AI client (endpoint,
 * timeouts, model inventory) is P-301's; doctor only needs reachability
 * plus an optional version for display. Non-critical by definition.
 */
export interface OllamaProbe {
  reachable: boolean;
  version: string | null;
  reason?: string;
}

/** Optional local-AI check (P-301): include only when a probe is provided. */
export function makeOllamaCheck(
  probe: () => Promise<Result<OllamaProbe, StitchError>>
): DependencyCheck {
  return {
    id: 'ollama',
    label: 'ollama (optional local AI)',
    critical: false,
    check: async () => {
      const probed = await probe();
      if (probed.isErr()) return err(probed.error);
      if (!probed.value.reachable) {
        const suffix = probed.value.reason === undefined ? '' : `: ${probed.value.reason}`;
        return ok({
          pass: false,
          detail: `ollama unreachable${suffix}`,
          fix: 'Start Ollama (`ollama serve`) or skip local AI — cloud providers still work',
        });
      }
      const version = probed.value.version ?? 'unknown version';
      return ok({ pass: true, detail: `ollama ${version} reachable` });
    },
  };
}

/**
 * Optional GitHub token presence (P-206). Only presence is reported — the
 * value is never echoed into detail, logs, or JSON (SECRETS.md).
 */
export function makeGitHubTokenCheck(
  readToken: () => string | undefined = defaultReadGitHubToken
): DependencyCheck {
  return {
    id: 'github-token',
    label: 'github token (optional)',
    critical: false,
    check: async () => {
      let token: string | undefined;
      try {
        token = readToken();
      } catch (cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return ok({ pass: false, detail: `github token probe failed: ${detail}` });
      }
      if (token === undefined || token === '') {
        return ok({
          pass: false,
          detail: 'no github token found',
          fix: 'Set GITHUB_TOKEN (or GH_TOKEN) to enable GitHub API features',
        });
      }
      return ok({ pass: true, detail: 'github token present' });
    },
  };
}

/** What buildDoctorChecks accepts: runner/probe overrides + optional gates. */
export interface DoctorCheckOptions {
  gitRun?: ProcessRunner;
  filterRepoRun?: ProcessRunner;
  dockerPing?: () => Promise<DockerReachability>;
  dockerReadVersion?: () => Promise<string>;
  /** Provide the P-301 probe to include the ollama check; omit to skip it. */
  ollamaProbe?: () => Promise<Result<OllamaProbe, StitchError>>;
  /** Include the token check (default env reader unless overridden). */
  includeGitHubToken?: boolean;
  readGitHubToken?: () => string | undefined;
}

/**
 * The deterministic ordered list: git, git-filter-repo, docker, then the
 * configured optionals (ollama, github-token). Required checks always run
 * with real defaults; tests inject seams through the same options.
 */
export function buildDoctorChecks(options: DoctorCheckOptions = {}): DependencyCheck[] {
  // Seams are assembled conditionally: exactOptionalPropertyTypes forbids
  // passing explicit undefined for `ping`/`readVersion`.
  const dockerSeams: DockerCheckSeams = {};
  if (options.dockerPing !== undefined) dockerSeams.ping = options.dockerPing;
  if (options.dockerReadVersion !== undefined) dockerSeams.readVersion = options.dockerReadVersion;
  const checks: DependencyCheck[] = [
    makeGitCheck(options.gitRun),
    makeFilterRepoCheck(options.filterRepoRun),
    makeDockerCheck(dockerSeams),
  ];
  if (options.ollamaProbe !== undefined) {
    checks.push(makeOllamaCheck(options.ollamaProbe));
  }
  if (options.includeGitHubToken === true || options.readGitHubToken !== undefined) {
    checks.push(makeGitHubTokenCheck(options.readGitHubToken));
  }
  return checks;
}

/** runDoctor options: just the concurrency cap (default 4). */
export interface RunDoctorOptions {
  concurrency?: number;
}

/**
 * Execute checks concurrently (P-031 mapLimit: per-item Results, input
 * order) and aggregate. `ok` is true only when every CRITICAL check
 * passed. Returns err(CONFIG_ERROR) only for a bad concurrency cap;
 * everything else — including throwing probes — lands in the report.
 */
export async function runDoctor(
  checks: readonly DependencyCheck[],
  options: RunDoctorOptions = {}
): Promise<Result<DoctorReport, StitchError>> {
  const mapped = await mapLimit(checks, options.concurrency ?? DOCTOR_CONCURRENCY, runOneCheck);
  if (mapped.isErr()) return err(mapped.error);
  const outcomes: CheckOutcome[] = mapped.value.map((r, index) => {
    if (r.isOk()) return r.value;
    const check = checks[index];
    if (check === undefined) {
      return {
        id: `check-${index}`,
        label: `check ${index}`,
        critical: true,
        pass: false,
        detail: `check runner failed: ${describeError(r.error)}`,
      };
    }
    return failedOutcome(check, `check runner failed: ${describeError(r.error)}`);
  });
  return ok({ ok: outcomes.every(o => !o.critical || o.pass), checks: outcomes });
}

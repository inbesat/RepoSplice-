import { describe, it, expect } from 'vitest';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { DockerReachability } from '../sandbox/docker.js';
import { MIN_GIT_VERSION } from '../git/version.js';
import {
  buildDoctorChecks,
  makeDockerCheck,
  makeFilterRepoCheck,
  makeGitCheck,
  makeGitHubTokenCheck,
  makeOllamaCheck,
  runDoctor,
  type CheckResult,
  type DependencyCheck,
  type DoctorReport,
} from './doctor.js';

/** A fully injected check: no process, no network, deterministic. */
function mockCheck(
  id: string,
  critical: boolean,
  result: Result<CheckResult, StitchError>,
  delayMs = 0
): DependencyCheck {
  return {
    id,
    label: `mock ${id}`,
    critical,
    check: async () => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      return result;
    },
  };
}

function passResult(detail: string): Result<CheckResult, StitchError> {
  return ok({ pass: true, detail });
}

function failResult(detail: string, fix: string): Result<CheckResult, StitchError> {
  return ok({ pass: false, detail, fix });
}

function outcomeById(report: DoctorReport, id: string): CheckResult & { critical: boolean } {
  const found = report.checks.find(c => c.id === id);
  expect(found).toBeDefined();
  if (found === undefined) throw new Error(`missing outcome ${id}`);
  return found;
}

describe('stitch doctor (P-068 system checks)', () => {
  it('git version', async () => {
    // New git passes and names the version (distro suffix tolerated).
    const fresh = makeGitCheck(async () => 'git version 2.45.1.windows.1');
    const good = await fresh.check();
    expect(good.isOk()).toBe(true);
    if (!good.isOk()) return;
    expect(good.value.pass).toBe(true);
    expect(good.value.detail).toContain('2.45.1');

    // Exactly the floor passes: the P-019 semver compare is inclusive.
    const floor = makeGitCheck(async () => 'git version 2.40.0');
    const atFloor = await floor.check();
    expect(atFloor.isOk()).toBe(true);
    if (!atFloor.isOk()) return;
    expect(atFloor.value.pass).toBe(true);

    // Below the floor fails with an upgrade hint naming the minimum.
    const old = makeGitCheck(async () => 'git version 2.30.0');
    const dated = await old.check();
    expect(dated.isOk()).toBe(true);
    if (!dated.isOk()) return;
    expect(dated.value.pass).toBe(false);
    expect(dated.value.detail).toContain('2.30.0');
    expect(dated.value.fix).toContain(MIN_GIT_VERSION);

    // Missing binary (runner throws) fails with an install hint, never errs.
    const missing = makeGitCheck(async () => {
      throw new Error('spawn git ENOENT');
    });
    const gone = await missing.check();
    expect(gone.isOk()).toBe(true);
    if (!gone.isOk()) return;
    expect(gone.value.pass).toBe(false);
    expect(gone.value.fix).toContain('Install');
  });

  it('filter repo', async () => {
    // Present binary passes and carries the raw revision opaquely.
    const present = makeFilterRepoCheck(async () => 'a40bce548d2c\n');
    const found = await present.check();
    expect(found.isOk()).toBe(true);
    if (!found.isOk()) return;
    expect(found.value.pass).toBe(true);
    expect(found.value.detail).toContain('a40bce548d2c');

    // Missing binary fails with the pip install hint, never errs.
    const missing = makeFilterRepoCheck(async () => {
      throw new Error('spawn git-filter-repo ENOENT');
    });
    const gone = await missing.check();
    expect(gone.isOk()).toBe(true);
    if (!gone.isOk()) return;
    expect(gone.value.pass).toBe(false);
    expect(gone.value.fix).toContain('pip install');
  });

  it('docker probe', async () => {
    const up = async (): Promise<DockerReachability> => ({ reachable: true });
    // Reachable daemon passes and names the engine version.
    const healthy = makeDockerCheck({ ping: up, readVersion: async () => '26.1.4\n' });
    const good = await healthy.check();
    expect(good.isOk()).toBe(true);
    if (!good.isOk()) return;
    expect(good.value.pass).toBe(true);
    expect(good.value.detail).toContain('26.1.4');

    // Refused daemon fails but stays non-critical data with a start hint.
    const refused = async (): Promise<DockerReachability> => ({
      reachable: false,
      reason: 'connect ECONNREFUSED /var/run/docker.sock',
    });
    const down = makeDockerCheck({ ping: refused, readVersion: async () => '' });
    const downResult = await down.check();
    expect(downResult.isOk()).toBe(true);
    if (!downResult.isOk()) return;
    expect(downResult.value.pass).toBe(false);
    expect(downResult.value.fix).toContain('Start');

    // Throwing ping (no binary at all) fails with the install hint.
    const throwing = async (): Promise<DockerReachability> => {
      throw new Error('spawn docker ENOENT');
    };
    const gone = makeDockerCheck({ ping: throwing, readVersion: async () => '' });
    const goneResult = await gone.check();
    expect(goneResult.isOk()).toBe(true);
    if (!goneResult.isOk()) return;
    expect(goneResult.value.pass).toBe(false);
    expect(goneResult.value.fix).toContain('not installed');
  });

  it('aggregate critical', async () => {
    // Default list is the deterministic required order, optionals off.
    expect(buildDoctorChecks().map(c => c.id)).toEqual(['git', 'git-filter-repo', 'docker']);

    // A slow critical check resolving after a fast one still reports in
    // input order: concurrency must not reorder the report.
    const checks: DependencyCheck[] = [
      mockCheck('git', true, passResult('git 2.45.1'), 30),
      mockCheck('git-filter-repo', true, failResult('not found', 'pip install it'), 0),
      mockCheck('docker', false, failResult('daemon down', 'start it'), 0),
      mockCheck(
        'boom',
        true,
        err<CheckResult, StitchError>({ code: 'INTERNAL', message: 'probe exploded' }),
        0
      ),
    ];
    const report = await runDoctor(checks, { concurrency: 4 });
    expect(report.isOk()).toBe(true);
    if (!report.isOk()) return;
    expect(report.value.checks.map(c => c.id)).toEqual([
      'git',
      'git-filter-repo',
      'docker',
      'boom',
    ]);
    // Any critical failure flips the report, and an err-ing check degrades
    // to a failed outcome naming its error code instead of rejecting.
    expect(report.value.ok).toBe(false);
    expect(outcomeById(report.value, 'git').pass).toBe(true);
    expect(outcomeById(report.value, 'docker').pass).toBe(false);
    expect(outcomeById(report.value, 'boom').detail).toContain('INTERNAL');

    // Criticals green + only the optional down: the report still passes.
    const lenient = await runDoctor(
      [
        mockCheck('git', true, passResult('git 2.45.1')),
        mockCheck('docker', false, failResult('daemon down', 'start it')),
      ],
      { concurrency: 2 }
    );
    expect(lenient.isOk()).toBe(true);
    if (!lenient.isOk()) return;
    expect(lenient.value.ok).toBe(true);

    // A throwing probe degrades to a failed outcome, never a rejection.
    const throwing: DependencyCheck = {
      id: 'throws',
      label: 'mock throws',
      critical: false,
      check: async () => {
        throw new Error('probe exploded');
      },
    };
    const caught = await runDoctor([throwing], { concurrency: 1 });
    expect(caught.isOk()).toBe(true);
    if (!caught.isOk()) return;
    expect(caught.value.ok).toBe(true);
    expect(outcomeById(caught.value, 'throws').detail).toContain('probe exploded');

    // Misuse (bad cap) is a typed CONFIG_ERROR, never a p-limit throw.
    const misuse = await runDoctor([mockCheck('git', true, passResult('x'))], { concurrency: 0 });
    expect(misuse.isErr()).toBe(true);
    if (!misuse.isErr()) return;
    expect(misuse.error.code).toBe('CONFIG_ERROR');
  });

  it('json shape', async () => {
    const report = await runDoctor(
      [
        mockCheck('git', true, passResult('git 2.45.1')),
        mockCheck('docker', false, failResult('daemon down', 'start it')),
      ],
      { concurrency: 2 }
    );
    expect(report.isOk()).toBe(true);
    if (!report.isOk()) return;
    const parsed = JSON.parse(JSON.stringify(report.value)) as DoctorReport;
    expect(Object.keys(parsed).sort()).toEqual(['checks', 'ok']);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks).toHaveLength(2);
    for (const entry of parsed.checks) {
      expect(entry).toMatchObject({ critical: expect.any(Boolean) as boolean });
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.pass).toBe('boolean');
      expect(typeof entry.detail).toBe('string');
    }
    // `fix` is absent (not null) when unset: the --json shape stays tight.
    const passing = parsed.checks[0];
    expect(passing).toBeDefined();
    if (passing === undefined) return;
    expect('fix' in passing).toBe(false);
    const failing = parsed.checks[1];
    expect(failing).toBeDefined();
    if (failing === undefined) return;
    expect(failing.fix).toBe('start it');
  });

  it('error rendering covers every code', async () => {
    // Every StitchError variant degrades to a failed outcome naming its
    // code — no variant can crash the aggregator or render blank.
    const errors: StitchError[] = [
      { code: 'GIT_ERROR', message: 'git blew up' },
      { code: 'GITHUB_API_ERROR', status: 500, message: 'server error' },
      { code: 'DOCKER_ERROR', message: 'daemon blew up' },
      { code: 'AI_PROVIDER_ERROR', provider: 'ollama', message: 'reset' },
      { code: 'LICENSE_VIOLATION', license: 'GPL-3.0', policy: 'deny' },
      { code: 'DEPENDENCY_CONFLICT', packages: ['a'], details: 'clash' },
      { code: 'SANDBOX_FAILED', step: 'build', logs: 'boom' },
      { code: 'CONFIG_ERROR', field: 'x', message: 'bad' },
      { code: 'USER_CANCELLED', reason: 'nope' },
      { code: 'INTERNAL', message: 'bug' },
      { code: 'AUTH_ERROR', provider: 'github', message: 'denied' },
      { code: 'COST_LIMIT', provider: 'openai', spentUsd: 9, limitUsd: 10 },
      { code: 'COMPLIANCE_VIOLATION', rule: 'r', message: 'violated' },
      { code: 'UNKNOWN_LICENSE', id: 'Mystery-1.0' },
    ];
    for (const error of errors) {
      const report = await runDoctor(
        [mockCheck('probe', true, err<CheckResult, StitchError>(error))],
        { concurrency: 1 }
      );
      expect(report.isOk()).toBe(true);
      if (!report.isOk()) continue;
      expect(report.value.ok).toBe(false);
      expect(outcomeById(report.value, 'probe').detail).toContain(error.code);
    }
  });

  it('optional checks', async () => {
    // Reachable ollama passes and names its version.
    const ollamaUp = makeOllamaCheck(async () => ok({ reachable: true, version: '0.9.1' }));
    const up = await ollamaUp.check();
    expect(up.isOk()).toBe(true);
    if (!up.isOk()) return;
    expect(up.value.pass).toBe(true);
    expect(up.value.detail).toContain('0.9.1');
    expect(ollamaUp.critical).toBe(false);

    // Unreachable ollama fails with a start hint.
    const ollamaDown = makeOllamaCheck(async () => ok({ reachable: false, version: null }));
    const down = await ollamaDown.check();
    expect(down.isOk()).toBe(true);
    if (!down.isOk()) return;
    expect(down.value.pass).toBe(false);
    expect(down.value.fix).toContain('ollama serve');

    // A failing probe Result propagates as err for the aggregator to shape.
    const ollamaErr = makeOllamaCheck(async () =>
      err<{ reachable: boolean; version: string | null }, StitchError>({
        code: 'AI_PROVIDER_ERROR',
        provider: 'ollama',
        message: 'connection reset',
      })
    );
    expect((await ollamaErr.check()).isErr()).toBe(true);

    // Present token passes without ever echoing the secret.
    const tokenSet = makeGitHubTokenCheck(() => 'ghp_exampletokenvalue');
    const set = await tokenSet.check();
    expect(set.isOk()).toBe(true);
    if (!set.isOk()) return;
    expect(set.value.pass).toBe(true);
    expect(set.value.detail).not.toContain('ghp_exampletokenvalue');

    // Absent token fails with the env-var hint.
    const tokenMissing = makeGitHubTokenCheck(() => undefined);
    const missing = await tokenMissing.check();
    expect(missing.isOk()).toBe(true);
    if (!missing.isOk()) return;
    expect(missing.value.pass).toBe(false);
    expect(missing.value.fix).toContain('GITHUB_TOKEN');

    // A throwing reader fails closed with context, never a rejection.
    const readerThrows = makeGitHubTokenCheck(() => {
      throw new Error('keychain down');
    });
    const readerDown = await readerThrows.check();
    expect(readerDown.isOk()).toBe(true);
    if (!readerDown.isOk()) return;
    expect(readerDown.value.pass).toBe(false);
    expect(readerDown.value.detail).toContain('keychain down');

    // Default reader: standard env names, restored afterwards.
    const savedToken = process.env['GITHUB_TOKEN'];
    const savedGhToken = process.env['GH_TOKEN'];
    try {
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GH_TOKEN'];
      const envAbsent = await makeGitHubTokenCheck().check();
      expect(envAbsent.isOk()).toBe(true);
      if (!envAbsent.isOk()) return;
      expect(envAbsent.value.pass).toBe(false);
      process.env['GH_TOKEN'] = 'ghp_fallbackname';
      const envPresent = await makeGitHubTokenCheck().check();
      expect(envPresent.isOk()).toBe(true);
      if (!envPresent.isOk()) return;
      expect(envPresent.value.pass).toBe(true);
      expect(envPresent.value.detail).not.toContain('ghp_fallbackname');
    } finally {
      if (savedToken === undefined) {
        delete process.env['GITHUB_TOKEN'];
      } else {
        process.env['GITHUB_TOKEN'] = savedToken;
      }
      if (savedGhToken === undefined) {
        delete process.env['GH_TOKEN'];
      } else {
        process.env['GH_TOKEN'] = savedGhToken;
      }
    }

    // Optionals join the ordered list only when configured.
    const full = buildDoctorChecks({
      ollamaProbe: async () => ok({ reachable: true, version: '0.9.1' }),
      includeGitHubToken: true,
    });
    expect(full.map(c => c.id)).toEqual([
      'git',
      'git-filter-repo',
      'docker',
      'ollama',
      'github-token',
    ]);
  });
});

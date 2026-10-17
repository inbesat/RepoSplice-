import { describe, it, expect, afterEach, vi } from 'vitest';
import { err, ok, type Result } from '@repo-stitcher/core';
import type { DoctorReport, StitchError } from '@repo-stitcher/core';
import { createProgram } from '../program.js';
import { makeBunCheck, makeNodeCheck } from '../checks/system.js';
import {
  renderDoctorReport,
  runDoctorCommand,
  makeConfigCheck,
  makeProviderCheck,
} from './doctor.js';

const OLD_NO_COLOR = process.env['NO_COLOR'];

afterEach(() => {
  if (OLD_NO_COLOR === undefined) {
    delete process.env['NO_COLOR'];
  } else {
    process.env['NO_COLOR'] = OLD_NO_COLOR;
  }
});

/** Plain (uncolored) rendering: colors are theme.ts's job, tested there. */
function plain(): void {
  process.env['NO_COLOR'] = '1';
}

function mixedReport(): DoctorReport {
  return {
    ok: false,
    checks: [
      { id: 'git', label: 'git >= 2.40.0', critical: true, pass: true, detail: 'git 2.45.1' },
      {
        id: 'docker',
        label: 'docker daemon',
        critical: false,
        pass: false,
        detail: 'docker daemon unreachable',
        fix: 'Start Docker Desktop',
      },
    ],
  };
}

function executeOk(report: DoctorReport): () => Promise<Result<DoctorReport, StitchError>> {
  return async () => ok(report);
}

describe('stitch doctor command (P-068 CLI, extended P-195)', () => {
  it('renders pass/warn with hint lines', () => {
    // P-195's pass/warn/fail tiers: a failing optional check is WARN; FAIL is
    // reserved for critical checks.
    plain();
    const text = renderDoctorReport(mixedReport(), {});
    expect(text).toContain('stitch doctor');
    expect(text).toContain('PASS');
    expect(text).toContain('WARN');
    expect(text).toContain('git >= 2.40.0');
    expect(text).toContain('docker daemon unreachable');
    expect(text).toContain('fix: Start Docker Desktop');
    expect(text).toContain('(optional)');
    expect(text).toContain('1/2 checks passed');
  });

  it('renders failing critical summary', () => {
    plain();
    const report: DoctorReport = {
      ok: false,
      checks: [
        {
          id: 'git',
          label: 'git >= 2.40.0',
          critical: true,
          pass: false,
          detail: 'git not found',
          fix: 'Install git',
        },
      ],
    };
    const text = renderDoctorReport(report, {});
    expect(text).toContain('FAIL');
    expect(text).toContain('critical check failed');
    expect(text).toContain('0/1 checks passed');
  });

  it('json output shape', () => {
    const text = renderDoctorReport(mixedReport(), { json: true });
    const parsed = JSON.parse(text) as DoctorReport;
    expect(Object.keys(parsed).sort()).toEqual(['checks', 'ok']);
    expect(parsed.ok).toBe(false);
    expect(parsed.checks).toHaveLength(2);
    expect(parsed.checks[0]).toMatchObject({ id: 'git', critical: true, pass: true });
    expect(parsed.checks[1]).toMatchObject({ id: 'docker', critical: false, pass: false });
  });

  it('exit code follows critical checks', async () => {
    const lines: string[] = [];
    const write = (line: string): void => {
      lines.push(line);
    };
    // All green: 0.
    const green: DoctorReport = {
      ok: true,
      checks: [{ id: 'git', label: 'git', critical: true, pass: true, detail: 'git 2.45.1' }],
    };
    await expect(runDoctorCommand({}, { execute: executeOk(green), write })).resolves.toBe(0);

    // Only the optional red: still 0 (informational, GH fallback covers it).
    const optionalRed: DoctorReport = {
      ok: true,
      checks: [
        { id: 'git', label: 'git', critical: true, pass: true, detail: 'git 2.45.1' },
        { id: 'docker', label: 'docker', critical: false, pass: false, detail: 'down' },
      ],
    };
    await expect(runDoctorCommand({}, { execute: executeOk(optionalRed), write })).resolves.toBe(0);

    // Critical red: nonzero, and the hint reaches the output.
    await expect(runDoctorCommand({}, { execute: executeOk(mixedReport()), write })).resolves.toBe(
      1
    );
    expect(lines.join('\n')).toContain('fix: Start Docker Desktop');

    // --json still exits 1 on critical failure, with parseable output.
    const jsonLines: string[] = [];
    await expect(
      runDoctorCommand(
        { json: true },
        { execute: executeOk(mixedReport()), write: l => jsonLines.push(l) }
      )
    ).resolves.toBe(1);
    expect((JSON.parse(jsonLines.join('\n')) as DoctorReport).ok).toBe(false);

    // A broken runner (not a failed check) is exit 2 with the error named.
    const broken = async (): Promise<Result<DoctorReport, StitchError>> =>
      err({ code: 'INTERNAL', message: 'probe harness down' });
    const errLines: string[] = [];
    await expect(
      runDoctorCommand({}, { execute: broken, write: l => errLines.push(l) })
    ).resolves.toBe(2);
    expect(errLines.join('\n')).toContain('INTERNAL');
  });

  it('runner errors name their code', async () => {
    // A broken runner (not a failed check) exits 2 and names the error,
    // for every StitchError variant — none may render blank or throw.
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
      const lines: string[] = [];
      const code = await runDoctorCommand(
        {},
        {
          execute: async () => err<DoctorReport, StitchError>(error),
          write: l => lines.push(l),
        }
      );
      expect(code).toBe(2);
      expect(lines.join('\n')).toContain(error.code);
    }
  });

  it('registers doctor on the program', () => {
    const program = createProgram();
    const doctor = program.commands.find(c => c.name() === 'doctor');
    expect(doctor).toBeDefined();
    let seen: unknown;
    doctor?.action((options: unknown) => {
      seen = options;
    });
    program.parse(['doctor', '--all'], { from: 'user' });
    expect(seen).toMatchObject({ all: true });

    // Fresh program (real action replaced): --help lists the new command.
    const helped = createProgram();
    helped.exitOverride();
    let out = '';
    helped.configureOutput({ writeOut: s => (out += s), writeErr: () => {} });
    try {
      helped.parse(['--help'], { from: 'user' });
    } catch (e) {
      expect((e as { code?: string }).code).toBe('commander.helpDisplayed');
    }
    expect(out).toContain('doctor');
  });

  it('registers exactly one doctor command', () => {
    const program = createProgram();
    expect(program.commands.filter(c => c.name() === 'doctor')).toHaveLength(1);
  });

  it('real action runs live probes and sets exit code', async () => {
    // Precedent: program.test.ts runs the real `status` action. Here the
    // probes are live (git/filter-repo/docker/bun/node on this machine), so
    // the assertions are env-agnostic on purpose: shape + exit-code contract,
    // never specific outcomes. Covers the default-execute closure and the
    // process.exitCode assignment.
    const program = createProgram();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const savedExitCode = process.exitCode;
    try {
      await program.parseAsync(['doctor'], { from: 'user' });
      expect([0, 1]).toContain(process.exitCode);
    } finally {
      spy.mockRestore();
      process.exitCode = savedExitCode;
    }
    const output = lines.join('\n');
    expect(output).toContain('stitch doctor');
    expect(output).toMatch(/PASS|WARN|FAIL/);
    expect(output).toContain('checks passed');
  });

  // -------------------------------------------------------------------------
  // P-195 additions: the mandated five (the `json output` case above stands).
  // -------------------------------------------------------------------------

  it('checks system deps', async () => {
    // Each factory: above-floor, below-floor, unparsable, and a missing
    // binary — every degraded outcome is a Result (never a throw), matching
    // core's makeGitCheck degradation rule.
    const enoent = (): Error => Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });

    const bunCheck = makeBunCheck(async () => '1.3.11');
    expect(bunCheck.critical).toBe(true);
    expect(bunCheck.label).toContain('1.1.0');
    const bun = (await bunCheck.check())._unsafeUnwrap();
    expect(bun.pass).toBe(true);

    const oldBun = (await makeBunCheck(async () => '1.0.8').check())._unsafeUnwrap();
    expect(oldBun.pass).toBe(false);
    expect(oldBun.fix).toContain('bun.sh');

    const brokenBun = (await makeBunCheck(async () => 'garbage').check())._unsafeUnwrap();
    expect(brokenBun.pass).toBe(false);

    const missingBun = (
      await makeBunCheck(async () => {
        throw enoent();
      }).check()
    )._unsafeUnwrap();
    expect(missingBun.pass).toBe(false);
    expect(missingBun.detail).toContain('not runnable');

    // Node: fallback tooling — the floor applies but the check is optional.
    const nodeCheck = makeNodeCheck(async () => 'v22.5.1');
    expect(nodeCheck.critical).toBe(false);
    const node = (await nodeCheck.check())._unsafeUnwrap();
    expect(node.pass).toBe(true);

    const oldNode = (await makeNodeCheck(async () => 'v20.11.0').check())._unsafeUnwrap();
    expect(oldNode.pass).toBe(false);
    expect(oldNode.fix).toContain('nodejs.org');
  });

  it('validates config', async () => {
    // A reason (P-192/ADR-079: loadConfig throws; the probe degrades it)
    // makes the row fail with a fix hint; a clean load passes.
    const invalid = makeConfigCheck(() => "GitHub config invalid: authType='pat' requires a token");
    const failed = (await invalid.check())._unsafeUnwrap();
    expect(failed.pass).toBe(false);
    expect(failed.detail).toContain('requires a token');
    expect(failed.fix).toContain('github.token');

    const valid = makeConfigCheck(() => undefined);
    const passed = (await valid.check())._unsafeUnwrap();
    expect(passed.pass).toBe(true);
  });

  it('reports provider key', async () => {
    // No resolvable credential: WARN row + how to fix. One provider named
    // (by env or the redacted store): a passing row listing them.
    const absent = makeProviderCheck(() => []);
    const failed = (await absent.check())._unsafeUnwrap();
    expect(absent.critical).toBe(false);
    expect(failed.pass).toBe(false);
    expect(failed.detail).toContain('no provider credential resolvable');
    expect(failed.fix).toContain('stitch init --provider');

    const present = makeProviderCheck(() => ['anthropic']);
    const passed = (await present.check())._unsafeUnwrap();
    expect(passed.pass).toBe(true);
    expect(passed.detail).toContain('configured: anthropic');
  });

  it('strict exit', async () => {
    // report.ok stays true while only the optional rows fail: exit 0 by
    // default (P-068's contract), exit 1 under --strict (P-195). A failed
    // CRITICAL check is exit 1 regardless.
    const lines: string[] = [];
    const write = (line: string): void => {
      lines.push(line);
    };
    const greenCritical: DoctorReport = {
      ok: true,
      checks: [
        { id: 'git', label: 'git', critical: true, pass: true, detail: 'git 2.45.1' },
        { id: 'docker', label: 'docker', critical: false, pass: false, detail: 'down' },
      ],
    };
    const executeOk = async (): Promise<Result<DoctorReport, StitchError>> => ok(greenCritical);
    await expect(runDoctorCommand({}, { execute: executeOk, write })).resolves.toBe(0);
    await expect(runDoctorCommand({ strict: true }, { execute: executeOk, write })).resolves.toBe(
      1
    );

    const executeFail = async (): Promise<Result<DoctorReport, StitchError>> => ok(mixedReport());
    await expect(runDoctorCommand({ strict: true }, { execute: executeFail, write })).resolves.toBe(
      1
    );
  });

  it('registers --strict on the program', () => {
    const program = createProgram();
    const doctor = program.commands.find(c => c.name() === 'doctor');
    let seen: unknown;
    doctor?.action((options: unknown) => {
      seen = options;
    });
    program.parse(['doctor', '--strict'], { from: 'user' });
    expect(seen).toMatchObject({ strict: true });
  });
});

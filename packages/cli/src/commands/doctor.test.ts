import { describe, it, expect, afterEach, vi } from 'vitest';
import { err, ok, type Result } from '@repo-stitcher/core';
import type { DoctorReport, StitchError } from '@repo-stitcher/core';
import { createProgram } from '../program.js';
import { renderDoctorReport, runDoctorCommand } from './doctor.js';

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

describe('stitch doctor command (P-068 CLI)', () => {
  it('renders pass/fail with hint lines', () => {
    plain();
    const text = renderDoctorReport(mixedReport(), {});
    expect(text).toContain('stitch doctor');
    expect(text).toContain('PASS');
    expect(text).toContain('FAIL');
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
    // probes are live (git/filter-repo/docker on this machine), so the
    // assertions are env-agnostic on purpose: shape + exit-code contract,
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
    expect(output).toMatch(/PASS|FAIL/);
    expect(output).toContain('checks passed');
  });
});

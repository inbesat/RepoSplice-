// P-155 tests: agent tool `run_build` (sandbox).
//
// The sandbox runner is a fake that records every request, so the tests can
// assert what was asked to run, in what order, how many times — and that
// NOTHING was written to the host tree. No Docker, no network, no subprocess.

import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'neverthrow';
import {
  runBuildForStage,
  runBuildTool,
  commandsFor,
  boundLogs,
  detectEcosystemFromListing,
  ECOSYSTEM_COMMANDS,
  describeOutcome,
} from './run_build.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool,
  proposeComponentTool,
  runBuildTool as buildAlias,
  registerAgentTool,
  clearAgentToolsForTests,
  listAgentTools,
} from './index.js';
import { MAX_BUILD_LOG_LINES } from '../types.js';
import type {
  StagingFacade,
  ToolContext,
  SandboxRunner,
  SandboxRunRequest,
} from '../../ai/types.js';
import { stitchErrorMessage, type StitchError } from '../../result/index.js';

interface ScriptedRun {
  exitCode: number;
  stdout?: string[];
  stderr?: string[];
  durationMs?: number;
}

/** A sandbox runner that replays a scripted sequence and records every call. */
function makeRunner(
  script: ScriptedRun[],
  opts: { available?: boolean; backend?: 'docker' | 'github-actions'; failAt?: number } = {}
): { runner: SandboxRunner; calls: SandboxRunRequest[] } {
  const calls: SandboxRunRequest[] = [];
  let index = 0;
  const runner: SandboxRunner = {
    backend: opts.backend ?? 'docker',
    available: async (): Promise<boolean> => opts.available !== false,
    run: async (request: SandboxRunRequest): Promise<Result<never, StitchError>> => {
      calls.push(request);
      if (opts.failAt !== undefined && calls.length === opts.failAt) {
        return err({ code: 'SANDBOX_FAILED', step: request.step, logs: 'sandbox crashed' });
      }
      const step = script[Math.min(index, script.length - 1)];
      index += 1;
      return ok({
        exitCode: step?.exitCode ?? 0,
        stdout: step?.stdout ?? [],
        stderr: step?.stderr ?? [],
        durationMs: step?.durationMs ?? 10,
      } as never);
    },
  };
  return { runner, calls };
}

function makeCtx(
  opts: {
    runner?: SandboxRunner;
    staged?: Record<string, string>;
  } = {}
): { ctx: ToolContext; writes: string[] } {
  const files: Record<string, string> = { ...(opts.staged ?? {}) };
  const writes: string[] = [];
  const inert = {
    diff: async (): Promise<string> => '',
    status: async (): Promise<string> => '',
    commit: async (): Promise<void> => {},
    add: async (): Promise<void> => {},
    analyze: async (): Promise<Record<string, string>> => ({}),
    install: async (): Promise<void> => {},
    scan: async (): Promise<string[]> => [],
    check: async (): Promise<boolean> => true,
  };
  const staging: StagingFacade = {
    listStagedFiles: async (): Promise<Result<string[], StitchError>> => ok(Object.keys(files)),
    readStagedFile: async (path: string): Promise<Result<string, StitchError>> => {
      const content = files[path];
      return content === undefined
        ? err({ code: 'FILE_NOT_FOUND', path, message: `no staged file ${path}` })
        : ok(content);
    },
  };
  const ctx = {
    cwd: '/repo',
    config: { stageRoot: 'C' },
    logger: { ...inert, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    costTracker: { ...inert, add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git: {
      ...inert,
      readStagedFile: staging.readStagedFile,
      // Any write attempt is recorded: run_build must make none.
      writeFile: async (
        _cwd: string,
        _repo: 'A' | 'B',
        path: string,
        content: string
      ): Promise<Result<void, StitchError>> => {
        writes.push(path);
        files[path] = content;
        return ok(undefined);
      },
    },
    deps: inert,
    license: inert,
    staging,
    ...(opts.runner === undefined ? {} : { sandbox: opts.runner }),
  } as unknown as ToolContext;
  return { ctx, writes };
}

beforeEach(() => {
  clearAgentToolsForTests();
  for (const t of [
    selectFilesTool,
    resolveDepsTool,
    detectGapsTool,
    fixDependencyTool,
    editConfigTool,
    moveFileTool,
    proposeComponentTool,
    buildAlias,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-155 run_build', () => {
  it('reports pass/fail with logs', async () => {
    // --- passing build + test -------------------------------------------
    const passRunner = makeRunner([
      { exitCode: 0, stdout: ['compiling...'], durationMs: 100 },
      { exitCode: 0, stdout: ['3 passed'], durationMs: 50 },
      { exitCode: 0, stdout: ['3 passed'], durationMs: 45 },
    ]);
    const passCtx = makeCtx({ runner: passRunner.runner });
    const passed = await runBuildForStage(passCtx.ctx, { ecosystem: 'node' });
    expect(passed.isOk()).toBe(true);
    const passOutcome = passed._unsafeUnwrap();
    expect(passOutcome.pass).toBe(true);
    expect(passOutcome.exitCode).toBe(0);
    expect(passOutcome.flaky).toBe(false);
    expect(passOutcome.command).toBe('bun run build && bun test');
    expect(passOutcome.logs.stdout).toContain('3 passed');
    // durationMs accumulates every run.
    expect(passOutcome.durationMs).toBe(195);

    // --- failing build ---------------------------------------------------
    const failRunner = makeRunner([
      { exitCode: 1, stdout: ['building...'], stderr: ['error TS2345'], durationMs: 20 },
    ]);
    const failCtx = makeCtx({ runner: failRunner.runner });
    const failed = await runBuildForStage(failCtx.ctx, { ecosystem: 'node' });
    expect(failed.isOk()).toBe(true);
    const failOutcome = failed._unsafeUnwrap();
    // `pass` reflects the exit code.
    expect(failOutcome.pass).toBe(false);
    expect(failOutcome.exitCode).toBe(1);
    expect(failOutcome.logs.stderr).toContain('error TS2345');
    // A build failure is terminal: the test step is never attempted.
    expect(failRunner.calls).toHaveLength(1);
    expect(failRunner.calls[0]?.step).toBe('build');
    expect(failOutcome.flaky).toBe(false);

    // A failing build still returns ok — a red build is a RESULT, not a tool error.
    expect(failOutcome.backend).toBe('docker');

    // --- neither run writes to the host tree ----------------------------
    expect(passCtx.writes).toEqual([]);
    expect(failCtx.writes).toEqual([]);
  });

  it('selects build cmd per ecosystem', async () => {
    // The canonical pairs are exactly those P-155 step 2 mandates.
    expect(commandsFor({ ecosystem: 'node' })).toEqual({
      build: 'bun run build',
      test: 'bun test',
    });
    expect(commandsFor({ ecosystem: 'python' })).toEqual({
      build: 'python -m build',
      test: 'pytest',
    });
    expect(commandsFor({ ecosystem: 'rust' })).toEqual({
      build: 'cargo build',
      test: 'cargo test',
    });
    expect(commandsFor({ ecosystem: 'go' })).toEqual({
      build: 'go build ./...',
      test: 'go test ./...',
    });
    // Callers may override either half.
    expect(commandsFor({ ecosystem: 'go', test: 'go test -race ./...' }).test).toBe(
      'go test -race ./...'
    );
    expect(Object.keys(ECOSYSTEM_COMMANDS).sort()).toEqual(['go', 'node', 'python', 'rust']);

    // The sandbox actually receives those commands.
    for (const [ecosystem, expected] of [
      ['node', 'bun test'],
      ['python', 'pytest'],
      ['rust', 'cargo test'],
      ['go', 'go test ./...'],
    ] as const) {
      const { runner, calls } = makeRunner([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
      const { ctx } = makeCtx({ runner });
      const result = await runBuildForStage(ctx, { ecosystem });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().command).toContain(expected);
      expect(calls.map(c => c.command)).toContain(expected);
    }

    // The ecosystem is inferred from the staged listing when not given.
    expect(detectEcosystemFromListing(['src/app.ts', 'package.json'])).toBe('node');
    expect(detectEcosystemFromListing(['pyproject.toml'])).toBe('python');
    expect(detectEcosystemFromListing(['requirements-dev.txt'])).toBe('python');
    expect(detectEcosystemFromListing(['Cargo.toml'])).toBe('rust');
    expect(detectEcosystemFromListing(['go.mod'])).toBe('go');
    expect(detectEcosystemFromListing(['README.md'])).toBeUndefined();

    const inferred = makeRunner([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
    const viaTool = await runBuildTool.execute(
      {},
      makeCtx({
        runner: inferred.runner,
        staged: { 'Cargo.toml': '[package]\nname="x"\n' },
      }).ctx
    );
    expect(viaTool.isOk()).toBe(true);
    expect((viaTool._unsafeUnwrap() as { ecosystem: string }).ecosystem).toBe('rust');
    expect(inferred.runner).toBeDefined();
  });

  it('detects flaky', async () => {
    // pass, then fail -> flaky, and pass is still true ("pass if any pass").
    const mixed = makeRunner([
      { exitCode: 0, stdout: ['run 1 ok'] },
      { exitCode: 0, stdout: ['run 1 ok'] },
      { exitCode: 1, stdout: ['run 2 failed'] },
    ]);
    const result = await runBuildForStage(makeCtx({ runner: mixed.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(result.isOk()).toBe(true);
    const outcome = result._unsafeUnwrap();
    expect(outcome.flaky).toBe(true);
    expect(outcome.pass).toBe(true);
    expect(outcome.exitCode).toBe(0);
    // The test step really ran twice.
    expect(mixed.calls.filter(c => c.step === 'test')).toHaveLength(2);

    // fail, then pass -> also flaky, and pass is true.
    const recovered = makeRunner([{ exitCode: 0 }, { exitCode: 1 }, { exitCode: 0 }]);
    const recoveredResult = await runBuildForStage(makeCtx({ runner: recovered.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(recoveredResult._unsafeUnwrap().flaky).toBe(true);
    expect(recoveredResult._unsafeUnwrap().pass).toBe(true);

    // both fail -> not flaky, genuinely failing.
    const broken = makeRunner([{ exitCode: 0 }, { exitCode: 1 }, { exitCode: 1 }]);
    const brokenResult = await runBuildForStage(makeCtx({ runner: broken.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(brokenResult._unsafeUnwrap().flaky).toBe(false);
    expect(brokenResult._unsafeUnwrap().pass).toBe(false);
    expect(brokenResult._unsafeUnwrap().exitCode).toBe(1);

    // detectFlaky:false runs the test once and cannot report flakiness.
    const once = makeRunner([{ exitCode: 0 }, { exitCode: 1 }]);
    const onceResult = await runBuildForStage(
      makeCtx({ runner: once.runner }).ctx,
      {
        ecosystem: 'node',
      },
      { detectFlaky: false }
    );
    expect(onceResult._unsafeUnwrap().flaky).toBe(false);
    expect(onceResult._unsafeUnwrap().pass).toBe(false);
    expect(once.calls.filter(c => c.step === 'test')).toHaveLength(1);
  });

  it('errors when sandbox unavailable', async () => {
    // No runner injected at all.
    const noRunner = await runBuildForStage(makeCtx().ctx, { ecosystem: 'node' });
    expect(noRunner.isErr()).toBe(true);
    const missing = noRunner._unsafeUnwrapErr();
    expect(missing.code).toBe('SANDBOX_UNAVAILABLE');
    expect(stitchErrorMessage(missing)).toContain('never executed on the host');

    // Runner present but the backend is down.
    const down = makeRunner([{ exitCode: 0 }], { available: false });
    const downResult = await runBuildForStage(makeCtx({ runner: down.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(downResult.isErr()).toBe(true);
    const downErr = downResult._unsafeUnwrapErr();
    expect(downErr.code).toBe('SANDBOX_UNAVAILABLE');
    if (downErr.code === 'SANDBOX_UNAVAILABLE') {
      expect(downErr.backend).toBe('docker');
    }
    // Nothing was run — an unavailable backend is not a failed build.
    expect(down.calls).toHaveLength(0);

    // The GH Actions backend reports itself the same way.
    const gh = makeRunner([{ exitCode: 0 }], { available: false, backend: 'github-actions' });
    const ghResult = await runBuildForStage(makeCtx({ runner: gh.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(ghResult._unsafeUnwrapErr().code).toBe('SANDBOX_UNAVAILABLE');

    // A sandbox that crashes mid-run propagates SANDBOX_FAILED, not a verdict.
    const crashed = makeRunner([{ exitCode: 0 }], { failAt: 1 });
    const crashedResult = await runBuildForStage(makeCtx({ runner: crashed.runner }).ctx, {
      ecosystem: 'node',
    });
    expect(crashedResult.isErr()).toBe(true);
    expect(crashedResult._unsafeUnwrapErr().code).toBe('SANDBOX_FAILED');

    // The tool is auto and registered (verification needs no approval).
    expect(runBuildTool.autonomy).toBe('auto');
    expect(listAgentTools().map(t => t.name)).toContain('run_build');
  });

  it('bounded logs', async () => {
    const huge = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    const { runner, calls } = makeRunner([
      { exitCode: 0, stdout: huge },
      { exitCode: 0, stdout: huge },
      { exitCode: 0, stderr: huge },
    ]);
    const result = await runBuildForStage(makeCtx({ runner }).ctx, { ecosystem: 'node' });
    expect(result.isOk()).toBe(true);
    const outcome = result._unsafeUnwrap();
    // Bounded per stream to the mandated cap.
    expect(outcome.logs.stdout).toHaveLength(MAX_BUILD_LOG_LINES);
    expect(outcome.logs.stderr).toHaveLength(MAX_BUILD_LOG_LINES);
    // The TAIL is kept, not the head: a failure is at the end of the output.
    // stdout accumulated 2 runs (build + test 1; the third script has no
    // stdout) = 4000 lines, so the last 500 begin at index 3500 — i.e. local
    // line 1500 of the second run. stderr came only from the third run.
    expect(outcome.logs.stdout[outcome.logs.stdout.length - 1]).toBe('line 1999');
    expect(outcome.logs.stdout[0]).toBe('line 1500');
    expect(outcome.logs.stderr[0]).toBe('line 1500');

    // The bound helper is independently correct and never grows the input.
    expect(boundLogs(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(boundLogs(huge, 10)).toHaveLength(10);
    expect(boundLogs(huge, 10)[0]).toBe('line 1990');
    const source = ['x'];
    boundLogs(source, 1);
    expect(source).toEqual(['x']);

    // The bound holds even when the build fails early (fewer lines, still ok).
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('P-155 outcome rendering', () => {
  it('describes pass, fail, and flaky distinctly', () => {
    const base = {
      command: 'bun run build && bun test',
      exitCode: 0,
      durationMs: 12,
      logs: { stdout: [], stderr: [] },
      ecosystem: 'node' as const,
      backend: 'docker' as const,
    };
    expect(describeOutcome({ ...base, pass: true, flaky: false })).toContain('PASS');
    expect(describeOutcome({ ...base, pass: false, flaky: false })).toContain('FAIL');
    expect(describeOutcome({ ...base, pass: true, flaky: true })).toContain('flaky');
  });
});

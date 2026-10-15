// P-167 — Agent Tools end-to-end suite.
//
// The gate that declares Epic 7 done. This is the ONLY test that exercises the
// whole agent stack at once: two real fixture repos, the real `GitFacade`
// (P-165), the real `DepsFacade`/`LicenseFacade` (P-166), the real tool
// registry, the real autonomy policy (P-157), the real undo stack (P-161), the
// real HIL queue (P-160), and the real `runToolLoop` (P-140) — with only the
// provider (P-144 `MockProvider`) and the sandbox backend (P-155's injected
// seam) stubbed, because a model call and a Docker build are exactly the two
// things that must not happen in an offline unit suite.
//
// Fixtures are built by the P-064 generator from SPECS committed below — the
// same "committed spec, generated repo" arrangement `gitFacade.test.ts` (P-165)
// and the P-087 git suites use. `PHASES_DETAILED.md:8450` allows either "the
// P-064 generator or committed [fixture repos]"; a committed `fixtures/` tree
// of `.js` files would be linted by the repo-wide `eslint .` (there is no
// fixtures ignore) and would have to carry nested `.git` directories, so the
// generator is the deterministic, hermetic choice. See ADR-040.
//
// The four required scenarios from the phase spec:
//
//   it('happy end-to-end compose')      (spec: 'happy end-to-end compose')
//   it('blocks on license with HIL')    (spec: 'blocks on license with HIL')
//   it('caps endless loop')             (spec: 'caps endless loop')
//   it('reverts bad edit')              (spec: 'reverts bad edit')

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import { generateFixtures, type FixtureSpec } from '../../../../../scripts/generate-fixtures.js';
import { runToolLoop } from '../../ai/loop.js';
import { MockProvider, type MockStep } from '../../ai/mock.js';
import { logger } from '../../logger/index.js';
import type { ChatProvider } from '../../ai/provider.js';
import type {
  ChatMessage,
  HilGate,
  HumanResponder,
  LoopResult,
  SandboxRunRequest,
  SandboxRunner,
  StagingFacade,
  ToolCall,
  ToolContext,
  ToolDefinition,
} from '../../ai/types.js';
import { type StitchError } from '../../result/index.js';
import { listFiles, resolveWithin } from '../../util/index.js';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../../store/schema.js';
import { writeFixturePkg } from '../../license/index.js';
import { createDepsFacade, createLicenseFacade } from '../depsLicenseFacade.js';
import { createGitFacade } from '../gitFacade.js';
import { HilQueue } from '../hil.js';
import { defaultAutonomyPolicy } from '../policy.js';
import { UndoStack, createUndoRecorder } from '../revert.js';
import { createRevertLastTool } from '../tools/revert_last.js';
import { listAgentTools } from '../tools/index.js';
import { runFixDependency } from '../tools/fix_dependency.js';
import type { FixResult } from '../types.js';

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Fixtures (P-064 generator specs — committed here, generated per run)
// ---------------------------------------------------------------------------

/** Repo A: a JS module that imports a dependency its manifest does not declare. */
const REPO_A: FixtureSpec = {
  name: 'repo-a',
  commits: [
    {
      message: 'initial',
      files: [
        {
          path: 'package.json',
          content: {
            text: JSON.stringify(
              { name: 'repo-a', version: '1.0.0', license: 'MIT', dependencies: {} },
              null,
              2
            ),
          },
        },
        {
          path: 'src/util.js',
          content: {
            text: "import leftPad from 'left-pad';\n\nexport function pad(n) {\n  return leftPad(String(n), 3, '0');\n}\n",
          },
        },
        {
          path: 'src/util.test.js',
          content: {
            text: "import { pad } from './util.js';\n\ntest('pads', () => {\n  expect(pad(7)).toBe('007');\n});\n",
          },
        },
      ],
    },
  ],
};

/** Repo B: a docs-only source. */
const REPO_B: FixtureSpec = {
  name: 'repo-b',
  commits: [
    {
      message: 'initial',
      files: [{ path: 'README.md', content: { text: '# repo-b\n' } }],
    },
  ],
};

/** Repo A', which declares a strong-copyleft dependency. */
const REPO_A_GPL: FixtureSpec = {
  name: 'repo-a-gpl',
  commits: [
    {
      message: 'initial',
      files: [
        {
          path: 'package.json',
          content: {
            text: JSON.stringify(
              {
                name: 'repo-a-gpl',
                version: '1.0.0',
                license: 'MIT',
                dependencies: { 'gpl-lib': '2.0.0' },
              },
              null,
              2
            ),
          },
        },
        {
          path: 'src/main.js',
          content: { text: "import gpl from 'gpl-lib';\n\nexport const x = gpl;\n" },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// In-memory DbLike (the P-145/P-160 test adapter pattern, local to this suite)
// ---------------------------------------------------------------------------

function makeAdapter(path = ':memory:'): DbLike {
  const raw = new DatabaseSync(path);
  const toInput = (p: SQLiteValue[]): (string | number | bigint | null | Uint8Array)[] =>
    p.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const wrap = (stmt: {
    all(...p: (string | number | bigint | null | Uint8Array)[]): Record<string, unknown>[];
    get(
      ...p: (string | number | bigint | null | Uint8Array)[]
    ): Record<string, unknown> | undefined;
    run(...p: (string | number | bigint | null | Uint8Array)[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }): StatementLike => ({
    all: (...p) => stmt.all(...toInput(p)) as SQLiteRow[],
    get: (...p) => (stmt.get(...toInput(p)) as SQLiteRow | undefined) ?? null,
    run: (...p) => {
      const r = stmt.run(...toInput(p));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
  });
  return {
    exec: sql => raw.exec(sql),
    query: sql => wrap(raw.prepare(sql)),
    close: () => raw.close(),
  };
}

// ---------------------------------------------------------------------------
// Orchestration harness (phase step 2)
// ---------------------------------------------------------------------------

/** One source file the compose step brings into C. */
export interface ComposeSelection {
  repo: 'A' | 'B';
  path: string;
}

/** One scripted assistant turn. */
export type Turn = { kind: 'calls'; calls: ToolCall[] } | { kind: 'text'; text: string };

export interface AgentE2EInput {
  /** Base repo-A checkout. */
  repoA: string;
  /** Base repo-B checkout. */
  repoB: string;
  /** The files the selection step brings into C (materialised before the loop). */
  selection: ComposeSelection[];
  /** Scripted assistant turns, in order. The final turn is replayed forever. */
  turns: Turn[];
  /**
   * Orchestrator hook run after C is composed and committed, before the loop.
   * Used to install fixture `node_modules` (what P-170 does in production).
   */
  prepare?: (stage: string) => Promise<void>;
  /** Approval callback for gated tools. Defaults to approving everything. */
  approvalGate?: (toolName: string) => Promise<boolean>;
  /** Durable HIL queue (P-160). When absent, the P-140 approvalGate is used. */
  hilQueue?: HilGate;
  /** How long a parked HIL request waits before USER_TIMEOUT. */
  hilTimeoutMs?: number;
  /** The undo stack (P-161). When present, `revert_last` is offered. */
  undoStack?: UndoStack;
  /** The channel a tool reaches a human through (P-156). */
  human?: HumanResponder;
  /** Loop cap. Default 8. */
  maxIterations?: number;
}

export interface AgentE2EOutput {
  /** Repo C — the child stage. */
  stage: string;
  /** The real facades, for post-loop assertions (e.g. the compliance gate). */
  git: ReturnType<typeof createGitFacade>;
  deps: ReturnType<typeof createDepsFacade>;
  license: ReturnType<typeof createLicenseFacade>;
  /** Every request the stub sandbox received, in order. */
  sandboxCalls: SandboxRunRequest[];
  /** The loop's outcome. */
  result: Result<LoopResult, StitchError>;
  /** Tool results by tool name (newest last), parsed from the loop's messages. */
  toolResults: Record<string, unknown[]>;
}

let workspaceRoot: string;
let fixtureRoot: string;

/** Copy one source file from a fixture repo into the stage, creating dirs. */
async function materialise(stage: string, source: string, relPath: string): Promise<void> {
  const target = join(stage, relPath);
  const slash = target.replace(/\\/g, '/').lastIndexOf('/');
  if (slash > 0) await mkdir(target.replace(/\\/g, '/').slice(0, slash), { recursive: true });
  await cp(join(source, relPath), target);
}

/** A read-only view of C (P-150), over the real stage directory. */
function createStagingFacade(stage: string): StagingFacade {
  const root = stage.replace(/\\/g, '/');
  return {
    listStagedFiles: async () => {
      const listing = await listFiles(stage, '**/*', {
        dot: false,
        ignore: ['**/.git/**', '.git/**', '**/.git'],
      });
      if (listing.isErr()) return err(listing.error);
      return ok(listing.value.map(p => p.replace(/\\/g, '/').slice(root.length + 1)).sort());
    },
    readStagedFile: async (path: string) => {
      const resolved = resolveWithin(stage, path.replace(/\\/g, '/'));
      if (resolved.isErr()) {
        return err({ code: 'CONFIG_ERROR', field: 'path', message: `"${path}" escapes C` });
      }
      try {
        return ok(await readFile(resolved.value, 'utf8'));
      } catch (cause: unknown) {
        return (cause as { code?: string }).code === 'ENOENT'
          ? err({ code: 'FILE_NOT_FOUND', path, message: `no staged file ${path}` })
          : err({ code: 'INTERNAL', message: String(cause) });
      }
    },
  };
}

/**
 * Run the whole agent pipeline over two fixture repos.
 *
 * The harness owns exactly the work the orchestrator (P-238) owns and the agent
 * tools deliberately do NOT: it materialises the selected files into C (tools
 * only *propose* a selection), initialises the stage as a git repo, and
 * persists `fix_dependency`'s computed manifest — P-151 is compute-only by
 * design ("the caller serializes/writes it, not this tool"). Everything the
 * loop then does runs through the real modules.
 */
export async function runAgentE2E(input: AgentE2EInput): Promise<AgentE2EOutput> {
  const stage = join(workspaceRoot, `stage-${Math.random().toString(36).slice(2, 10)}`);
  await mkdir(stage, { recursive: true });
  await run('git', ['-C', stage, 'init', '-b', 'main', '-q']);
  await run('git', ['-C', stage, 'config', 'user.email', 'stitch@test.dev']);
  await run('git', ['-C', stage, 'config', 'user.name', 'Stitch Test']);

  // Orchestrator step 1: write the selected files into C (the merge does this).
  for (const entry of input.selection) {
    const source = entry.repo === 'A' ? input.repoA : input.repoB;
    await materialise(stage, source, entry.path);
  }
  await run('git', ['-C', stage, 'add', '-A']);
  await run('git', ['-C', stage, 'commit', '-q', '-m', 'compose: selection', '--no-gpg-sign']);

  if (input.prepare !== undefined) await input.prepare(stage);

  // Real facades (P-165/P-166) — the whole point of the acceptance criterion.
  const git = createGitFacade({ repoA: input.repoA, repoB: input.repoB, repoC: stage });
  const deps = createDepsFacade({ stage });
  const license = createLicenseFacade({ stage });
  const staging = createStagingFacade(stage);

  // Stub sandbox (P-155 seam): a real `SandboxRunner`, no Docker.
  const sandboxCalls: SandboxRunRequest[] = [];
  const sandbox: SandboxRunner = {
    backend: 'docker',
    available: async () => true,
    run: async (request: SandboxRunRequest) => {
      sandboxCalls.push(request);
      return ok({ exitCode: 0, stdout: [`${request.step} ok`], stderr: [], durationMs: 1 });
    },
  };

  const context = {
    cwd: stage,
    config: { stageRoot: 'C' },
    logger,
    costTracker: { add: () => {}, totalTokens: { input: 0, output: 0, total: 0 } },
    git,
    deps,
    license,
    staging,
    sandbox,
    ...(input.human !== undefined ? { human: input.human } : {}),
  } as unknown as ToolContext;

  // The registry, plus `revert_last` when a stack is wired, plus the
  // orchestrator's persistence adapter for `fix_dependency`.
  const registered = new Map(listAgentTools().map(t => [t.name, t]));
  if (input.undoStack !== undefined) {
    registered.set('revert_last', createRevertLastTool(input.undoStack));
  }
  const tools = [...registered.values()].map(tool =>
    tool.name === 'fix_dependency' ? withManifestPersistence(tool, input.selection) : tool
  );

  const provider = providerFrom(input.turns);
  const messages: ChatMessage[] = [{ role: 'user', content: 'compose repos A and B into C' }];

  const result = await runToolLoop(provider, tools, messages, {
    maxIterations: input.maxIterations ?? 8,
    context,
    policy: defaultAutonomyPolicy(),
    approvalGate: input.approvalGate ?? (async () => true),
    ...(input.hilQueue !== undefined ? { hilQueue: input.hilQueue } : {}),
    ...(input.hilTimeoutMs !== undefined ? { hilTimeoutMs: input.hilTimeoutMs } : {}),
    ...(input.undoStack !== undefined ? { undoStack: createUndoRecorder(input.undoStack) } : {}),
  });

  return {
    stage,
    git,
    deps,
    license,
    sandboxCalls,
    result,
    toolResults: collectToolResults(result),
  };
}

/**
 * Wrap `fix_dependency` with the persistence the orchestrator owns.
 *
 * P-151's outcome carries `manifest` + `serialized` and documents "the caller
 * serializes/writes it, not this tool". The harness is that caller, exactly as
 * the pipeline is in production; the tool's own logic is untouched. Two things
 * matter here:
 *
 * - The `selection` is threaded through so the tool's post-fix closure re-check
 *   (P-151 step 4) knows what was composed — `ToolDefinition.execute` has no
 *   options channel, which is why P-151 exposes it on `runFixDependency`.
 * - The fix is MERGED into C's existing manifest rather than replaced by the
 *   tool's synthetic one (`runFixDependency` models only `{name, dependencies}`),
 *   because a real manifest carries `license`, `version` and `scripts` that the
 *   compliance gate (P-120) and the build (P-155) both read.
 */
function withManifestPersistence(
  tool: ToolDefinition,
  selection: readonly ComposeSelection[]
): ToolDefinition {
  return {
    ...tool,
    execute: async (args: unknown, ctx: ToolContext) => {
      const outcome = await runFixDependency(args, ctx, { selection: [...selection] });
      if (outcome.isErr()) return outcome;
      const written = await mergeManifestFix(ctx, outcome.value);
      if (written.isErr()) return written;
      return outcome;
    },
  };
}

/** Write one dependency fix into C's manifest, preserving every other field. */
async function mergeManifestFix(
  ctx: ToolContext,
  fix: FixResult
): Promise<Result<void, StitchError>> {
  const git = ctx.git;
  if (git.writeFile === undefined) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'git.writeFile',
      message: 'manifest persistence requires GitFacade.writeFile',
    });
  }
  let current: Result<string, StitchError>;
  if (git.readStagedFile !== undefined) {
    current = await git.readStagedFile('package.json');
  } else if (git.readFile !== undefined) {
    current = await git.readFile(ctx.cwd, 'A', 'package.json');
  } else {
    current = err({
      code: 'CONFIG_ERROR',
      field: 'git.readStagedFile',
      message: 'manifest persistence requires a manifest read surface',
    });
  }
  if (current.isErr()) return err(current.error);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(current.value) as Record<string, unknown>;
  } catch (cause: unknown) {
    return err({ code: 'DEPS_PARSE_ERROR', file: 'package.json', message: String(cause) });
  }
  const existing = parsed[fix.section];
  const section =
    existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  parsed[fix.section] = { ...section, [fix.package]: fix.version };
  return git.writeFile(ctx.cwd, 'A', 'package.json', `${JSON.stringify(parsed, null, 2)}\n`);
}

/** Build a per-turn provider queue (P-144); the last turn is replayed forever. */
function providerFrom(turns: Turn[]): ChatProvider {
  const providers = turns.map(turn => {
    const steps: MockStep[] =
      turn.kind === 'text'
        ? [
            { kind: 'text', text: turn.text },
            { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
          ]
        : [
            ...turn.calls.map(toolCall => ({ kind: 'tool_call' as const, toolCall })),
            { kind: 'finish', finishReason: 'tool_calls' },
          ];
    return new MockProvider({ script: steps });
  });
  if (providers.length === 0) providers.push(new MockProvider({ echoContent: 'done' }));
  const last = providers.length - 1;
  let turn = 0;
  return {
    name: 'mock',
    model: 'mock-model',
    provider: 'mock',
    id: 'mock/mock-model',
    chat: (...args: Parameters<MockProvider['chat']>) => {
      const index = Math.min(turn++, last);
      const chosen = providers[index];
      if (chosen === undefined) throw new Error('provider queue is empty');
      return chosen.chat(...args);
    },
    countTokens: (messages: ChatMessage[]) =>
      messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
    isRetryable: () => false,
  };
}

/** Parse every `role: 'tool'` message into `name -> results` (newest last). */
function collectToolResults(result: Result<LoopResult, StitchError>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  if (result.isErr()) return out;
  const loop = result.value;
  for (const message of loop.messages) {
    if (message.role !== 'tool' || message.toolCallId === undefined) continue;
    const owner = findCallName(loop.messages, message.toolCallId);
    if (owner === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(message.content);
      (out[owner] ??= []).push(parsed);
    } catch {
      // A non-JSON tool result is not ours to interpret.
    }
  }
  return out;
}

/** Walk the messages to find which tool a `toolCallId` belongs to. */
function findCallName(messages: ChatMessage[], toolCallId: string): string | undefined {
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.id === toolCallId) return call.name;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'stitch-e2e-'));
  fixtureRoot = await mkdtemp(join(tmpdir(), 'stitch-e2e-fx-'));
  const built = await generateFixtures([REPO_A, REPO_B, REPO_A_GPL], {
    root: fixtureRoot,
    clean: false,
  });
  if (built.isErr()) throw new Error(`fixtures failed: ${built.error.message}`);
}, 60_000);

afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(fixtureRoot, { recursive: true, force: true });
});

let callSeq = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `call-${name}-${++callSeq}`,
  name,
  arguments: args,
});

describe('P-167 agent end-to-end', () => {
  it('happy end-to-end compose', async () => {
    const out = await runAgentE2E({
      repoA: join(fixtureRoot, 'repo-a'),
      repoB: join(fixtureRoot, 'repo-b'),
      selection: [
        { repo: 'A', path: 'package.json' },
        { repo: 'A', path: 'src/util.js' },
        { repo: 'A', path: 'src/util.test.js' },
        { repo: 'B', path: 'README.md' },
      ],
      turns: [
        { kind: 'calls', calls: [call('select_files', { repo: 'A', paths: ['src/util.js'] })] },
        {
          kind: 'calls',
          calls: [
            call('resolve_dependency_closure', { files: [{ repo: 'A', path: 'src/util.js' }] }),
          ],
        },
        {
          kind: 'calls',
          calls: [call('fix_dependency', { package: 'left-pad', range: '^1.3.0' })],
        },
        { kind: 'calls', calls: [call('run_build', {})] },
        { kind: 'text', text: 'composed' },
      ],
    });

    expect(out.result.isOk()).toBe(true);

    // Selected files are present in C.
    expect(await readFile(join(out.stage, 'src', 'util.js'), 'utf8')).toContain('left-pad');
    expect(await readFile(join(out.stage, 'README.md'), 'utf8')).toBe('# repo-b\n');

    // The selection tool reported the file it proposed.
    const selection = out.toolResults['select_files']?.[0] as
      { files?: { path: string }[] } | undefined;
    expect(selection?.files?.some(f => f.path === 'src/util.js')).toBe(true);

    // The closure noticed the missing dependency...
    const closure = out.toolResults['resolve_dependency_closure']?.[0] as
      { missing?: string[]; required?: string[] } | undefined;
    expect(closure?.required).toContain('left-pad');
    expect(closure?.missing).toContain('left-pad');

    // ...and the fix landed in C's manifest (the tool computes, the harness persists).
    const fix = out.toolResults['fix_dependency']?.[0] as
      { serialized?: string; closure?: { satisfied?: boolean } } | undefined;
    expect(fix?.serialized).toContain('left-pad');
    expect(fix?.closure?.satisfied).toBe(true);
    const manifest = JSON.parse(await readFile(join(out.stage, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['left-pad']).toBeDefined();

    // The build ran through the sandbox seam: build once, test twice (P-155).
    expect(out.sandboxCalls.map(c => c.step)).toEqual(['build', 'test', 'test']);
    const build = out.toolResults['run_build']?.[0] as { pass?: boolean } | undefined;
    expect(build?.pass).toBe(true);

    // The compliance gate allows the composed child.
    const gate = await out.license.complianceGate();
    expect(gate.blocking).toBe(false);
    expect(gate.report.verdict).toBe('allow');
  }, 60_000);

  it('blocks on license with HIL', async () => {
    const hilQueue = new HilQueue({ db: makeAdapter() });
    const human: HumanResponder = { present: async () => ({ kind: 'cancelled' }) };

    const out = await runAgentE2E({
      repoA: join(fixtureRoot, 'repo-a-gpl'),
      repoB: join(fixtureRoot, 'repo-b'),
      selection: [
        { repo: 'A', path: 'package.json' },
        { repo: 'A', path: 'src/main.js' },
      ],
      // The installed GPL dependency the scan will find (P-170 installs these).
      prepare: async stage => {
        await writeFixturePkg(stage, 'gpl-lib', '2.0.0', 'GPL-3.0-only');
      },
      hilQueue,
      hilTimeoutMs: 150,
      human,
      turns: [
        {
          kind: 'calls',
          calls: [
            call('ask_user', {
              prompt: 'A GPL dependency was detected. Proceed with composing C?',
              options: ['yes', 'no'],
            }),
          ],
        },
        { kind: 'text', text: 'stopped' },
      ],
    });

    // The real policy engine blocks: the installed strong-copyleft dep is denied.
    const gate = await out.license.complianceGate();
    expect(gate.blocking).toBe(true);
    expect(gate.report.matrix.decision).not.toBe('allow');

    // The gated tool parked a durable, still-pending request in `waiting_approval`.
    const pending = hilQueue.pending();
    expect(pending.isOk()).toBe(true);
    if (pending.isOk()) {
      expect(pending.value).toHaveLength(1);
      const request = pending.value[0];
      expect(request?.toolName).toBe('ask_user');
      expect(request?.agentState).toBe('waiting_approval');
      expect(request?.status).toBe('pending');
    }

    // C was NOT finalised: the blocked run left the stage as composed.
    const subjects = await run('git', ['-C', out.stage, 'log', '--format=%s']);
    expect(subjects.stdout).toContain('compose: selection');
    expect(subjects.stdout).not.toContain('left-pad');
    expect(subjects.stdout.trim().split('\n')).toHaveLength(1); // baseline commit only
  }, 60_000);

  it('caps endless loop', async () => {
    const out = await runAgentE2E({
      repoA: join(fixtureRoot, 'repo-a'),
      repoB: join(fixtureRoot, 'repo-b'),
      selection: [{ repo: 'A', path: 'package.json' }],
      maxIterations: 3,
      // One turn, replayed forever: the model never stops asking for a tool.
      turns: [
        { kind: 'calls', calls: [call('select_files', { repo: 'A', paths: ['package.json'] })] },
      ],
    });

    expect(out.result.isErr()).toBe(true);
    if (out.result.isErr()) expect(out.result.error.code).toBe('LOOP_LIMIT');
  }, 60_000);

  it('reverts bad edit', async () => {
    const out = await runAgentE2E({
      repoA: join(fixtureRoot, 'repo-a'),
      repoB: join(fixtureRoot, 'repo-b'),
      selection: [{ repo: 'A', path: 'package.json' }],
      undoStack: new UndoStack(),
      approvalGate: async () => true,
      turns: [
        {
          kind: 'calls',
          calls: [
            call('edit_config', {
              path: 'C/package.json',
              op: 'set',
              key: 'name',
              value: 'tampered',
            }),
          ],
        },
        { kind: 'calls', calls: [call('revert_last', { reason: 'undo bad rename' })] },
        { kind: 'text', text: 'reverted' },
      ],
    });

    expect(out.result.isOk()).toBe(true);

    // The bad edit really happened...
    const edit = out.toolResults['edit_config']?.[0] as { after?: string } | undefined;
    expect(edit?.after).toContain('tampered');

    // ...and `revert_last` restored the prior content on disk.
    const reverted = out.toolResults['revert_last']?.[0] as
      { reverted?: { tool?: string } } | undefined;
    expect(reverted?.reverted?.tool).toBe('edit_config');
    const manifest = JSON.parse(await readFile(join(out.stage, 'package.json'), 'utf8')) as {
      name: string;
    };
    expect(manifest.name).toBe('repo-a');
  }, 60_000);
});

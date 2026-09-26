// P-157 tests: the Autonomy Policy Engine.
//
// The policy is pure and deterministic, so most tests are direct `evaluate`
// calls. The loop test drives the real `runToolLoop` with a scripted provider
// to prove the verdict is actually honoured at execution time — a policy that
// is correct in isolation but ignored by the loop would pass everything else.

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  AutonomyPolicy,
  defaultAutonomyPolicy,
  policyFromAgentConfig,
  DEFAULT_GATED_TOOLS,
  ALWAYS_ALLOWED_TOOLS,
} from './policy.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { AiAuditLog, POLICY_TASK } from '../ai/audit.js';
import {
  selectFilesTool,
  resolveDepsTool,
  detectGapsTool,
  fixDependencyTool,
  editConfigTool,
  moveFileTool,
  proposeComponentTool,
  runBuildTool,
  askUserTool,
  clearAgentToolsForTests,
  registerAgentTool,
  listAgentTools,
} from './index.js';
// `Autonomy` from the barrel is the P-009 config block; the per-tool mode is
// re-exported as `ToolAutonomy` (see agent/types.ts).
import type { ToolAutonomy, AutonomyOverride, ChatMessage } from '../index.js';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike, ToolDefinition } from '../index.js';
import { ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';

/** `node:sqlite`-backed `DbLike` (vitest runs on Node; `bun:sqlite` is unavailable). */
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

/** A tool that records whether it actually ran. */
function spyTool(name: string, autonomy: ToolAutonomy, log: string[]): ToolDefinition {
  return {
    name,
    description: `spy ${name}`,
    schema: { value: z.string().optional() },
    autonomy,
    execute: async (): Promise<Result<unknown, StitchError>> => {
      log.push(name);
      return ok(name);
    },
  };
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
    runBuildTool,
    askUserTool,
  ]) {
    expect(registerAgentTool(t).isOk()).toBe(true);
  }
});

describe('P-157 AutonomyPolicy', () => {
  it('allows auto tool', () => {
    const policy = defaultAutonomyPolicy();
    // Every tool that declares itself `auto` is allowed with no gate.
    for (const name of [
      'select_files',
      'resolve_dependency_closure',
      'detect_gaps',
      'fix_dependency',
      'edit_config',
      'move_file',
      'run_build',
    ]) {
      expect(policy.evaluate(name, 'auto').action).toBe('allow');
    }
    // And the verdict carries a reason, not just a boolean.
    const decision = policy.evaluate('select_files', 'auto');
    expect(decision.reason).toContain('select_files');
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('asks on gated tool', () => {
    const policy = defaultAutonomyPolicy();
    // The two tools that declare themselves gated both require a human.
    expect(policy.evaluate('propose_component', 'gated').action).toBe('ask');
    expect(policy.evaluate('ask_user', 'gated').action).toBe('ask');
    // Every gated tool is asked, not just the two defaults.
    expect(policy.evaluate('anything_else', 'gated').action).toBe('ask');

    // The declared defaults match the tools that actually declare themselves.
    expect(DEFAULT_GATED_TOOLS).toEqual(['propose_component', 'ask_user']);
    const gatedInRegistry = listAgentTools()
      .filter(t => t.autonomy === 'gated')
      .map(t => t.name);
    expect(gatedInRegistry.sort()).toEqual([...DEFAULT_GATED_TOOLS].sort());
    // run_build is verify-only, so it is always allowed.
    expect(ALWAYS_ALLOWED_TOOLS).toEqual(['run_build']);
    expect(policy.evaluate('run_build', 'gated').action).toBe('allow');
  });

  it('denies blacklisted tool', () => {
    const policy = defaultAutonomyPolicy().withDeniedTool('move_file');
    // Deny wins over the tool's own `auto` flag...
    expect(policy.evaluate('move_file', 'auto').action).toBe('deny');
    // ...and over an override that would otherwise re-enable it.
    const overridden = policy.withOverride({ tool: 'move_file', mode: 'auto' });
    expect(overridden.evaluate('move_file', 'auto').action).toBe('deny');
    // And it is refused with a reason that names the deny list.
    expect(policy.evaluate('move_file', 'auto').reason).toContain('deny list');
    // Other tools are unaffected.
    expect(policy.evaluate('edit_config', 'auto').action).toBe('allow');
    // The base policy is untouched — `with*` returns a NEW policy.
    expect(defaultAutonomyPolicy().evaluate('move_file', 'auto').action).toBe('allow');
  });

  it('applies override', () => {
    const overrides: AutonomyOverride[] = [
      { tool: 'propose_component', mode: 'auto' },
      { tool: 'edit_config', mode: 'gated' },
    ];
    const policy = new AutonomyPolicy({ overrides, defaultMode: 'auto', denyTools: [] });
    // gated -> auto: no longer needs a human.
    expect(policy.evaluate('propose_component', 'gated').action).toBe('allow');
    expect(policy.effectiveMode('propose_component', 'gated')).toBe('auto');
    // auto -> gated: now needs one.
    expect(policy.evaluate('edit_config', 'auto').action).toBe('ask');
    expect(policy.effectiveMode('edit_config', 'auto')).toBe('gated');
    // The override wins over the tool's flag in both directions.
    expect(policy.evaluate('propose_component', 'gated').reason).toContain('overridden');
    // A tool with no override keeps its own flag.
    expect(policy.evaluate('select_files', 'auto').action).toBe('allow');

    // The `[agent]` config block (P-009) maps onto overrides, and a tool in
    // both lists is a configuration error rather than a silent last-wins.
    const fromConfig = policyFromAgentConfig({ auto: ['detect_gaps'], gated: ['fix_dependency'] });
    expect(fromConfig.isOk()).toBe(true);
    expect(fromConfig._unsafeUnwrap().evaluate('detect_gaps', 'gated').action).toBe('allow');
    expect(fromConfig._unsafeUnwrap().evaluate('fix_dependency', 'auto').action).toBe('ask');

    const conflict = policyFromAgentConfig({ auto: ['edit_config'], gated: ['edit_config'] });
    expect(conflict.isErr()).toBe(true);
    expect(conflict._unsafeUnwrapErr().code).toBe('CONFIG_ERROR');

    // Determinism: identical inputs always produce an identical decision.
    for (let i = 0; i < 5; i += 1) {
      expect(policy.evaluate('edit_config', 'auto')).toEqual(
        policy.evaluate('edit_config', 'auto')
      );
    }
    // A config array mutated after construction cannot change the policy.
    overrides.push({ tool: 'select_files', mode: 'gated' });
    expect(policy.evaluate('select_files', 'auto').action).toBe('allow');
  });

  it('loop honors verdict', async () => {
    const log: string[] = [];
    const tools: ToolDefinition[] = [
      spyTool('allowed_tool', 'auto', log),
      spyTool('gated_tool', 'gated', log),
      spyTool('denied_tool', 'auto', log),
    ];

    /** Two scripted turns: one call, then a stop. */
    const runLoop = async (
      policy: AutonomyPolicy,
      toolName: string,
      approve: boolean
    ): Promise<{ content: string; ran: string[] }> => {
      const first = new MockProvider({
        script: [
          { kind: 'tool_call', toolCall: { id: 'c1', name: toolName, arguments: {} } },
          { kind: 'finish', finishReason: 'tool_calls' },
        ],
      });
      const second = new MockProvider({
        script: [
          { kind: 'text', text: 'done' },
          { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
        ],
      });
      let turn = 0;
      const provider = {
        name: 'mock',
        model: 'mock-model',
        provider: 'mock' as const,
        id: 'mock/mock-model',
        chat: (...args: Parameters<MockProvider['chat']>) =>
          (turn++ === 0 ? first : second).chat(...args),
        countTokens: (messages: ChatMessage[]) =>
          messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
        isRetryable: () => false,
      };
      const result = await runToolLoop(provider, tools, [{ role: 'user', content: 'go' }], {
        maxIterations: 3,
        policy,
        approvalGate: async () => approve,
      });
      expect(result.isOk()).toBe(true);
      const toolMsg = result._unsafeUnwrap().messages.find(m => m.role === 'tool');
      return { content: toolMsg?.content ?? '', ran: log.splice(0) };
    };

    // allow -> the tool runs, and its result comes back to the model.
    const allowed = await runLoop(defaultAutonomyPolicy(), 'allowed_tool', false);
    expect(allowed.ran).toEqual(['allowed_tool']);

    // ask -> routed to the HIL gate; declined, so the tool never runs.
    const askedAndDenied = await runLoop(defaultAutonomyPolicy(), 'gated_tool', false);
    expect(askedAndDenied.ran).toEqual([]);
    expect(askedAndDenied.content).toContain('TOOL_DENIED');

    // ask -> approved, so the tool runs.
    const askedAndApproved = await runLoop(defaultAutonomyPolicy(), 'gated_tool', true);
    expect(askedAndApproved.ran).toEqual(['gated_tool']);

    // deny -> refused without ever consulting the gate, even when approved.
    const denyPolicy = defaultAutonomyPolicy().withDeniedTool('denied_tool');
    const denied = await runLoop(denyPolicy, 'denied_tool', true);
    expect(denied.ran).toEqual([]);
    expect(denied.content).toContain('TOOL_DENIED');
    expect(denied.content).toContain('autonomy policy');
  });

  it('logs decision', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });
    const policy = defaultAutonomyPolicy().withDeniedTool('move_file');

    // One decision of each kind.
    policy.evaluate('select_files', 'auto', { audit });
    policy.evaluate('propose_component', 'gated', { audit });
    policy.evaluate('move_file', 'auto', { audit });

    const rows = await audit.query({ task: POLICY_TASK });
    expect(rows).toHaveLength(3);

    const byAction = new Map(rows.map(r => [r.policy?.action, r]));
    expect(byAction.get('allow')?.policy?.tool).toBe('select_files');
    expect(byAction.get('ask')?.policy?.tool).toBe('propose_component');
    expect(byAction.get('deny')?.policy?.tool).toBe('move_file');

    // Every row carries its reason, the modes involved, and the deny flag.
    for (const row of rows) {
      expect(row.policy?.reason.length ?? 0).toBeGreaterThan(0);
      expect(row.policy?.effectiveMode).toBeTruthy();
      expect(row.policy?.requestedMode).toBeTruthy();
      expect(typeof row.policy?.denied).toBe('boolean');
      // A policy check calls no model, so no fabricated cost or latency.
      expect(row.inputTokens).toBe(0);
      expect(row.costUsd).toBe(0);
      expect(row.latencyMs).toBe(0);
    }
    // Only the deny-list row is marked denied.
    expect(byAction.get('deny')?.policy?.denied).toBe(true);
    expect(byAction.get('allow')?.policy?.denied).toBe(false);

    // Evaluating without an audit sink still works — logging is best-effort.
    const noAudit = defaultAutonomyPolicy().evaluate('select_files', 'auto');
    expect(noAudit.action).toBe('allow');
  });
});

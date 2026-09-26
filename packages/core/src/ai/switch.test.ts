// P-146 tests: runtime provider switch, failover policy, and the loop's
// mid-turn recovery.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../store/schema.js';
import type { StitchError } from '../result/index.js';
import { AiAuditLog, PROVIDER_SWITCH_TASK } from './audit.js';
import { clearActiveProviderForTests, getActiveProvider } from './registry.js';
import {
  ProviderManager,
  switchProvider,
  buildFailoverOrder,
  isFailoverCandidate,
  shouldFailover,
  DEFAULT_MAX_FAILOVER_SWITCHES,
} from './switch.js';
import { runToolLoop } from './loop.js';
import { MockProvider } from './mock.js';
import { MODELS } from './models.js';
import type { ChatMessage, LoopConfig, ToolDefinition } from './types.js';

/** `node:sqlite`-backed `DbLike` (vitest runs on Node, so `bun:sqlite` is out). */
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

/** A provider whose id matches a curated ModelSpec, so policy gates apply. */
function providerForModel(modelId: string, name = 'test'): MockProvider {
  const spec = MODELS.find(m => m.id === modelId);
  if (!spec) throw new Error(`fixture: no model ${modelId}`);
  return new MockProvider({ name: `${name}/${modelId}`, model: spec.id });
}

const GEMINI_BLOCKED = MODELS.find(m => m.toolCalling === 'blocked-by-default')?.id;

/** A tools model whose tool calling is allowed (for the policy allow-case). */
const TOOLS_ALLOWED = MODELS.find(m => m.supportsTools && m.toolCalling === 'allowed')?.id;

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hello' }];

afterEach(() => {
  clearActiveProviderForTests();
});

describe('P-146 switch: starts on primary and switches', () => {
  it('starts on primary and switches', () => {
    const primary = new MockProvider({ name: 'primary' });
    const backup = new MockProvider({ name: 'backup' });
    const spare = new MockProvider({ name: 'spare' });
    const manager = new ProviderManager(primary, [backup, spare]);

    // The primary is live until something forces a switch.
    expect(manager.active).toBe(primary);
    expect(manager.failoverOrder).toHaveLength(2);

    const next = manager.switchToNext('primary returned 429');
    expect(next).toBe(backup);
    expect(manager.switchCount).toBe(1);

    // The cursor advances; it does not bounce back to the first candidate.
    expect(manager.switchToNext('backup also failed')).toBe(spare);

    // Exhausted: null, not a throw.
    expect(manager.switchToNext('nothing left')).toBeNull();

    // The primary is never a failover target for itself.
    const noSelf = new ProviderManager(primary, [primary, backup]);
    expect(noSelf.failoverOrder).toEqual([backup]);
  });

  it('setActive moves the cursor so the next switch continues forward', () => {
    const a = new MockProvider({ name: 'a' });
    const b = new MockProvider({ name: 'b' });
    const c = new MockProvider({ name: 'c' });
    const manager = new ProviderManager(a, [b, c]);

    manager.setActive(b);
    expect(manager.active).toBe(b);
    expect(manager.switchToNext('manual pick, now fail')).toBe(c);
  });

  it('publishes the active provider for CLI/web', () => {
    const primary = new MockProvider({ name: 'primary' });
    const backup = new MockProvider({ name: 'backup' });
    const manager = new ProviderManager(primary, [backup]);

    const result = switchProvider(manager, '429 from primary');
    expect(result.isOk()).toBe(true);
    expect(getActiveProvider()).toBe(result._unsafeUnwrap());
  });
});

describe('P-146 switch: records audit on switch', () => {
  it('records audit on switch', async () => {
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });
    const primary = new MockProvider({ name: 'primary', model: 'p-model' });
    const backup = new MockProvider({ name: 'backup', model: 'b-model' });
    const manager = new ProviderManager(primary, [backup]);

    const result = switchProvider(manager, 'primary rate limited', { audit });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(backup);

    const rows = await audit.query({ task: PROVIDER_SWITCH_TASK });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // reason, from -> to, and ts are all recoverable from the audit trail.
    expect(row.switch).toBeDefined();
    expect(row.switch?.reason).toBe('primary rate limited');
    expect(row.switch?.from).toBe(primary.id);
    expect(row.switch?.to).toBe(backup.id);
    expect(row.provider).toBe(backup.provider);
    expect(Date.parse(row.ts)).not.toBeNaN();

    // A switch is not a model call: no fabricated tokens or cost.
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(0);
    expect(row.costUsd).toBe(0);
  });

  it('records nothing when there is no failover left', async () => {
    const audit = new AiAuditLog(makeAdapter(), { flushEvery: 1 });
    const primary = new MockProvider({ name: 'lonely' });
    const manager = new ProviderManager(primary, []);

    const result = switchProvider(manager, 'nothing configured', { audit });
    expect(result.isErr()).toBe(true);
    expect(await audit.query({ task: PROVIDER_SWITCH_TASK })).toHaveLength(0);
  });
});

describe('P-146 switch: returns NO_FAILOVER when empty', () => {
  it('returns NO_FAILOVER when empty', () => {
    const primary = new MockProvider({ name: 'primary' });
    const manager = new ProviderManager(primary, []);

    const result = switchProvider(manager, 'primary down');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const error = result.error;
      expect(error.code).toBe('NO_FAILOVER');
      if (error.code === 'NO_FAILOVER') {
        expect(error.exhausted).toEqual([]);
        expect(error.message).toContain(primary.id);
      }
    }

    // A second call is still exhausted, not a throw.
    expect(switchProvider(manager, 'again').isErr()).toBe(true);
  });

  it('reports policy-rejected candidates in `exhausted`', () => {
    // A candidate that fails the contract guard is skipped, and the exhausted
    // list explains why NO_FAILOVER happened.
    const primary = new MockProvider({ name: 'primary' });
    const broken = { name: 'broken', model: 'm', provider: 'x', id: 'x' };
    const manager = new ProviderManager(primary, [broken as never]);

    const result = switchProvider(manager, 'primary down');
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'NO_FAILOVER') {
      expect(result.error.exhausted).toHaveLength(1);
      expect(result.error.exhausted[0]).toContain('contract validation failed');
    }
  });
});

describe('P-146 switch: recovers turn on failover', () => {
  const noopTool: ToolDefinition = {
    name: 'noop',
    description: 'does nothing',
    schema: { value: z.string() },
    execute: async () => ok('done'),
    autonomy: 'auto',
  };

  function loopConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
    return { maxIterations: 1, ...overrides };
  }

  it('recovers turn on failover', async () => {
    // A failing primary (rate limit => retryable) and a working failover.
    const failing = new MockProvider({
      name: 'failing',
      failWith: {
        kind: 'rate_limit',
        message: '429 slow down',
        providerName: 'failing',
        retryable: true,
      },
    });
    const working = new MockProvider({
      name: 'working',
      script: [
        { kind: 'text', text: 'recovered' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 5, output: 7, total: 12 } },
      ],
    });
    const manager = new ProviderManager(failing, [working]);

    const result = await runToolLoop(
      failing,
      [noopTool],
      MESSAGES,
      loopConfig({ providerManager: manager })
    );

    // The job completes on the failover provider rather than erroring out.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.finalContent).toContain('recovered');
      expect(result.value.finishReason).toBe('stop');
    }
    expect(manager.active).toBe(working);
  });

  it('does not fail over for a non-retryable error', async () => {
    // `auth` failures are not retryable: another backend would fail the same
    // way, so the loop must surface the error instead of burning the budget.
    const unauthorized = new MockProvider({
      name: 'unauthorized',
      failWith: {
        kind: 'auth',
        message: '401 bad key',
        providerName: 'unauthorized',
        retryable: false,
      },
    });
    const backup = new MockProvider({ name: 'backup' });
    const manager = new ProviderManager(unauthorized, [backup]);

    const result = await runToolLoop(
      unauthorized,
      [noopTool],
      MESSAGES,
      loopConfig({ providerManager: manager })
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('AI_PROVIDER_ERROR');
    expect(manager.active).toBe(unauthorized);
    expect(manager.switchCount).toBe(0);
    expect(shouldFailover({ kind: 'auth', message: '', providerName: 'p', retryable: false })).toBe(
      false
    );
  });

  it('honors the per-job switch budget', async () => {
    // Every provider in the chain fails, so the loop must stop after the budget
    // instead of bouncing through the list forever.
    const failWith = (name: string) =>
      new MockProvider({
        name,
        failWith: {
          kind: 'network',
          message: 'unreachable',
          providerName: name,
          retryable: true,
        },
      });
    const manager = new ProviderManager(failWith('p0'), [
      failWith('p1'),
      failWith('p2'),
      failWith('p3'),
    ]);

    const result = await runToolLoop(
      manager.active,
      [noopTool],
      MESSAGES,
      loopConfig({ providerManager: manager, maxFailoverSwitches: 2 })
    );

    expect(result.isErr()).toBe(true);
    // 1 primary attempt + 2 budgeted switches, never all four providers.
    expect(manager.switchCount).toBe(2);
    expect(DEFAULT_MAX_FAILOVER_SWITCHES).toBe(2);
  });

  it('surfaces NO_FAILOVER state when the chain is empty', async () => {
    const failing = new MockProvider({
      name: 'failing',
      failWith: {
        kind: 'rate_limit',
        message: '429',
        providerName: 'failing',
        retryable: true,
      },
    });
    const manager = new ProviderManager(failing, []);

    const result = await runToolLoop(
      failing,
      [noopTool],
      MESSAGES,
      loopConfig({ providerManager: manager })
    );

    // With nothing to fail over to, the provider error itself is the result.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('AI_PROVIDER_ERROR');
  });
});

describe('P-146 switch: fires onProviderSwitch', () => {
  it('fires onProviderSwitch', async () => {
    const failing = new MockProvider({
      name: 'failing',
      failWith: {
        kind: 'timeout',
        message: 'gateway timeout',
        providerName: 'failing',
        retryable: true,
      },
    });
    const backup = new MockProvider({
      name: 'backup',
      script: [
        { kind: 'text', text: 'ok' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    const manager = new ProviderManager(failing, [backup]);

    const seen: { reason: string; from: string; to: string }[] = [];
    const result = await runToolLoop(failing, [], MESSAGES, {
      maxIterations: 1,
      providerManager: manager,
      onProviderSwitch: info => {
        seen.push({ reason: info.reason, from: info.from, to: info.to });
      },
    });

    expect(result.isOk()).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toContain('gateway timeout');
    expect(seen[0]?.from).toBe(failing.id);
    expect(seen[0]?.to).toBe(backup.id);
  });
});

describe('P-146 switch: respects model policy', () => {
  it('skips a tools-blocked model for a tools task', () => {
    if (!GEMINI_BLOCKED) throw new Error('fixture: expected a blocked-by-default model');
    if (!TOOLS_ALLOWED) throw new Error('fixture: expected a tools-allowed model');
    const primary = new MockProvider({ name: 'primary' });
    const blocked = providerForModel(GEMINI_BLOCKED, 'blocked');
    const allowed = providerForModel(TOOLS_ALLOWED, 'allowed');
    const manager = new ProviderManager(primary, [blocked, allowed]);

    const result = switchProvider(manager, 'primary down', { needsTools: true });
    expect(result.isOk()).toBe(true);
    // The blocked candidate is skipped, not returned.
    expect(result._unsafeUnwrap()).toBe(allowed);
  });

  it('allows a tools-blocked model for a non-tools task', () => {
    if (!GEMINI_BLOCKED) throw new Error('fixture: expected a blocked-by-default model');
    const primary = new MockProvider({ name: 'primary' });
    const blocked = providerForModel(GEMINI_BLOCKED, 'blocked');
    const manager = new ProviderManager(primary, [blocked]);

    // No tools required, so the P-143 block does not apply.
    const result = switchProvider(manager, 'primary down', { needsTools: false });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(blocked);
  });

  it('still rejects a blocked model when a tool policy is supplied', () => {
    if (!GEMINI_BLOCKED) throw new Error('fixture: expected a blocked-by-default model');
    const primary = new MockProvider({ name: 'primary' });
    const blocked = providerForModel(GEMINI_BLOCKED, 'blocked');
    const manager = new ProviderManager(primary, [blocked]);

    // The option is forwarded to the gate, but the curated blocked-by-default
    // model also declares `supportsTools: false`, so the deeper P-135
    // capability gate rejects it either way. The `overrideToolModels` opt-in
    // itself is covered in `block.test.ts` (P-143).
    const result = switchProvider(manager, 'primary down', {
      needsTools: true,
      toolPolicy: { overrideToolModels: [GEMINI_BLOCKED] },
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'NO_FAILOVER') {
      expect(result.error.exhausted[0]).toContain('does not support tool calling');
    }
  });

  it('rejects a candidate whose context window is too small', () => {
    const primary = new MockProvider({ name: 'primary' });
    const small = MODELS.find(m => m.contextWindow < 100_000);
    if (!small) throw new Error('fixture: expected a small-context model');
    const candidate = providerForModel(small.id, 'small');
    const manager = new ProviderManager(primary, [candidate]);

    const result = switchProvider(manager, 'primary down', { contextNeeded: 1_000_000 });
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'NO_FAILOVER') {
      expect(result.error.exhausted[0]).toContain('context window');
    }
  });
});

describe('P-146 switch: builds failover order from provider ids', () => {
  const okProvider = (id: string): Result<MockProvider, StitchError> =>
    ok(new MockProvider({ name: id }));

  it('drops unknown ids and providers without keys', () => {
    expect(isFailoverCandidate('openrouter')).toBe(false); // no key in env
    expect(isFailoverCandidate('mock')).toBe(true); // keyless by design
    expect(isFailoverCandidate('nope')).toBe(false); // unknown provider

    const built = buildFailoverOrder('mock', ['mock', 'nope', 'ollama'], okProvider);
    expect(built.isOk()).toBe(true);
    if (built.isOk()) {
      // primary excluded, unknown dropped, keyless ollama kept
      expect(built.value.map(p => p.name)).toEqual(['ollama']);
    }
  });

  it('propagates a build failure when nothing usable remains', () => {
    const failing = (): Result<MockProvider, StitchError> =>
      err({ code: 'INVALID_PROVIDER', message: 'cannot construct' });
    const built = buildFailoverOrder('mock', ['mock', 'ollama'], failing);
    expect(built.isErr()).toBe(true);
    if (built.isErr()) expect(built.error.code).toBe('INVALID_PROVIDER');
  });
});

// P-158 tests: tool args and tool-result validation.
//
// The validators are pure, so most tests call them directly. Two tests are
// integration-level on purpose:
//
//   - `loop validates before execute` drives the real `runToolLoop`, because a
//     validator that is correct in isolation but not actually wired in front of
//     `execute` would pass every other test while leaving the hole open.
//   - the audit assertions use a real `node:sqlite` database, because the
//     acceptance criterion is "recorded in audit", which is a claim about
//     persistence and not about a return value.
//
// PROTOTYPE POLLUTION is asserted against a real `Object.prototype` guard: the
// tests check that `Object.prototype` is unmodified after each hostile input,
// since a test that only checks the return value would pass even if the
// pollution had already happened on the way in.

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ok, err } from 'neverthrow';
import {
  validateToolResult,
  sanitizeToolArgs,
  validateToolCall,
  createToolValidator,
  auditValidationFailure,
  MAX_TOOL_RESULT_BYTES,
  MAX_TOOL_ARGS_DEPTH,
  FORBIDDEN_ARG_KEYS,
  STRICT_PATH_SAFE,
} from './validation.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { AiAuditLog, VALIDATION_TASK } from '../ai/audit.js';
import { defaultAutonomyPolicy } from './policy.js';
import { selectFilesTool, clearAgentToolsForTests, registerAgentTool } from './index.js';
import { defaultConfig } from '../config/schema.js';
import type { ChatMessage, DbLike, SQLiteRow, SQLiteValue, StatementLike } from '../index.js';
import type { ToolDefinition } from '../ai/types.js';
import { stitchErrorMessage, type StitchError } from '../result/index.js';

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

/**
 * A permissive tool used wherever the test cares about validation rather than
 * about the tool's own behaviour. `execute` is supplied per test.
 */
function testTool(
  name: string,
  execute: ToolDefinition['execute'],
  schema: ToolDefinition['schema'] = { path: z.string() }
): ToolDefinition {
  return { name, description: `test tool ${name}`, schema, autonomy: 'auto', execute };
}

beforeEach(() => {
  clearAgentToolsForTests();
  expect(registerAgentTool(selectFilesTool).isOk()).toBe(true);
  // Any pollution from a previous test would silently make later assertions pass.
  delete (Object.prototype as unknown as Record<string, unknown>)['polluted'];
});

describe('P-158 tool validation', () => {
  it('passes err through', () => {
    const tool = testTool('t', async () => ok('unused'));

    // Every err variant survives unchanged, by identity: a tool that already
    // failed must not be able to have its error replaced by a size complaint.
    const original: StitchError = { code: 'LOOP_LIMIT', message: 'iteration budget exhausted' };
    const passed = validateToolResult(tool, err(original));
    expect(passed.isErr()).toBe(true);
    if (passed.isErr()) {
      expect(passed.error).toBe(original);
      expect(passed.error.code).toBe('LOOP_LIMIT');
      expect(stitchErrorMessage(passed.error)).toBe('iteration budget exhausted');
    }

    // Even a huge *err* payload is untouched — the size bound applies to what
    // goes into the model's context, and an err is already a short message.
    const bigErr: StitchError = { code: 'LOOP_LIMIT', message: 'x'.repeat(2_000_000) };
    const bigPassed = validateToolResult(tool, err(bigErr));
    expect(bigPassed.isErr()).toBe(true);
    if (bigPassed.isErr()) expect(bigPassed.error).toBe(bigErr);

    // A small ok result passes and is returned intact.
    const okResult = validateToolResult<{ files: string[] }>(tool, ok({ files: ['a.ts'] }));
    expect(okResult.isOk()).toBe(true);
    if (okResult.isOk()) expect(okResult.value).toEqual({ files: ['a.ts'] });

    // A tool that returns the *wrong* value is not this layer's business: only
    // the size and serializability of an ok result are checked here, and a
    // shape mismatch is the tool's own contract, asserted in its own test file.
    const notTooBig = validateToolResult(tool, ok('a'.repeat(10)));
    expect(notTooBig.isOk()).toBe(true);
  });

  it('rejects oversized result', () => {
    const tool = testTool('big', async () => ok('unused'));

    // Just under the bound is accepted; one byte over is not.
    const under = 'a'.repeat(MAX_TOOL_RESULT_BYTES - 2); // JSON adds two quotes
    expect(validateToolResult(tool, ok(under)).isOk()).toBe(true);

    const over = validateToolResult(tool, ok('a'.repeat(MAX_TOOL_RESULT_BYTES + 1)));
    expect(over.isErr()).toBe(true);
    if (over.isErr()) {
      expect(over.error.code).toBe('TOOL_RESULT_TOO_LARGE');
      if (over.error.code !== 'TOOL_RESULT_TOO_LARGE') throw new Error('unreachable');
      // The error carries both numbers so the UI can explain itself without
      // re-measuring the payload.
      expect(over.error.max).toBe(MAX_TOOL_RESULT_BYTES);
      expect(over.error.size).toBeGreaterThan(MAX_TOOL_RESULT_BYTES);
      expect(over.error.message).toContain('maxToolResultBytes');
    }

    // The bound is configurable — this is the handoff note's "large-repo tools
    // can raise it", and it comes from the P-009 `[agent]` block.
    const raised = validateToolResult(tool, ok('a'.repeat(2_000_000)), {
      maxResultBytes: 4_000_000,
    });
    expect(raised.isOk()).toBe(true);

    // ...and the shipped config default is wired to the same two numbers, so
    // raising the bound is a config edit rather than a code change.
    expect(defaultConfig.agent.maxToolResultBytes).toBe(MAX_TOOL_RESULT_BYTES);
    expect(defaultConfig.agent.maxToolArgsDepth).toBe(MAX_TOOL_ARGS_DEPTH);

    // A value that cannot be serialized is reported, not thrown: JSON.stringify
    // throws on a cycle, and a validator that throws takes the loop with it.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const unserializable = validateToolResult(tool, ok(cyclic));
    expect(unserializable.isErr()).toBe(true);
    if (unserializable.isErr()) {
      expect(unserializable.error.code).toBe('TOOL_ARGS_VALIDATION');
      expect(stitchErrorMessage(unserializable.error)).toContain('cannot be serialized');
    }

    // A BigInt also breaks JSON.stringify; same treatment.
    expect(validateToolResult(tool, ok({ n: BigInt(1) })).isErr()).toBe(true);
  });

  it('sanitizes proto keys', () => {
    const tool = testTool('p', async () => ok('unused'), {
      opts: z.record(z.string(), z.unknown()),
    });

    // The denylist is P-152's, not the spec sketch's two: `constructor` is the
    // same class of attack and one codebase-wide list is worth more.
    expect(FORBIDDEN_ARG_KEYS).toEqual(['__proto__', 'prototype', 'constructor']);

    // A top-level `__proto__` as a REAL own key (what JSON.parse produces).
    const topLevel = JSON.parse('{"opts":{"__proto__":{"polluted":"yes"}}}') as unknown;
    const topResult = sanitizeToolArgs(tool, topLevel);
    expect(topResult.isErr()).toBe(true);
    if (topResult.isErr()) {
      expect(topResult.error.code).toBe('TOOL_ARGS_VALIDATION');
      expect(stitchErrorMessage(topResult.error)).toContain('prototype-polluting key');
    }
    expect((Object.prototype as unknown as Record<string, unknown>)['polluted']).toBeUndefined();

    // Deep inside arrays and nested objects — the check is recursive.
    for (const hostile of [
      { opts: { nested: { deeper: JSON.parse('{"__proto__":{"polluted":"yes"}}') } } },
      { opts: { list: [1, 2, JSON.parse('{"__proto__":{"polluted":"yes"}}')] } },
      { opts: JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}') },
    ]) {
      const result = sanitizeToolArgs(tool, hostile);
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(stitchErrorMessage(result.error)).toContain('prototype-polluting key');
      expect((Object.prototype as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
    }

    // An ordinary `__proto__`-free payload is untouched, and the name of a
    // field that merely CONTAINS the substring is not a hit.
    const clean = sanitizeToolArgs(tool, { opts: { prototypeNotes: 'x', path: 'src/a.ts' } });
    expect(clean.isOk()).toBe(true);

    // P-139 still runs: a proto-free but wrong-shaped payload fails its own way.
    const wrongShape = sanitizeToolArgs(tool, { opts: 'not-an-object' });
    expect(wrongShape.isErr()).toBe(true);
    if (wrongShape.isErr()) expect(wrongShape.error.code).toBe('TOOL_ARGS_VALIDATION');
  });

  it('rejects traversal paths', () => {
    const tool = testTool('m', async () => ok('unused'), {
      path: z.string(),
      paths: z.array(z.string()).optional(),
    });

    // The allowlist is the spec's STRICT_PATH_SAFE.
    expect(STRICT_PATH_SAFE).toContain('path');
    expect(STRICT_PATH_SAFE).toContain('paths');

    // Escaping at the root is refused, in both slash flavours and for absolute
    // and drive-qualified paths.
    for (const bad of [
      '../outside.ts',
      '../../.ssh/authorized_keys',
      '..\\..\\windows\\system32',
      '/etc/passwd',
      'C:\\Windows\\System32',
      './../escape.ts',
    ]) {
      const result = sanitizeToolArgs(tool, { path: bad });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(stitchErrorMessage(result.error)).toContain('escapes the repository root');
        expect(stitchErrorMessage(result.error)).toContain(bad);
      }
    }

    // The `paths` array form is checked element by element.
    const inArray = sanitizeToolArgs(tool, { path: 'ok.ts', paths: ['a.ts', '../bad.ts'] });
    expect(inArray.isErr()).toBe(true);

    // A `..` that only cancels a preceding segment stays INSIDE and is legal.
    // Rejecting `a/../b` would break real callers, which is the whole reason
    // the check resolves the path rather than just grepping for "..".
    expect(sanitizeToolArgs(tool, { path: 'a/../b.ts' }).isOk()).toBe(true);
    expect(sanitizeToolArgs(tool, { path: './src/./index.ts' }).isOk()).toBe(true);
    expect(sanitizeToolArgs(tool, { path: 'a/b/../../c/d.ts' }).isOk()).toBe(true);
    expect(sanitizeToolArgs(tool, { path: 'src/index.ts' }).isOk()).toBe(true);

    // A field that is NOT path-shaped is never treated as one, or a traversal
    // check on prose would be a false-positive generator.
    const prose = testTool('d', async () => ok('unused'), { description: z.string() });
    expect(sanitizeToolArgs(prose, { description: 'compare ../old and ./new' }).isOk()).toBe(true);
  });

  it('bounds depth', () => {
    const tool = testTool('deep', async () => ok('unused'), {
      opts: z.record(z.string(), z.unknown()),
    });

    expect(MAX_TOOL_ARGS_DEPTH).toBe(16);

    /** Build a nest `levels` objects deep. */
    const nest = (levels: number): Record<string, unknown> => {
      let node: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < levels; i += 1) node = { child: node };
      return { opts: node };
    };

    // Under the bound is accepted, at the bound is accepted, over is refused.
    expect(sanitizeToolArgs(tool, nest(3)).isOk()).toBe(true);
    const atBound = sanitizeToolArgs(tool, nest(10));
    expect(atBound.isOk()).toBe(true);

    const tooDeep = sanitizeToolArgs(tool, nest(40));
    expect(tooDeep.isErr()).toBe(true);
    if (tooDeep.isErr()) {
      expect(stitchErrorMessage(tooDeep.error)).toContain('nest deeper than');
      // The message names where the walk stopped, so a caller can see which
      // argument was pathological rather than just "too deep".
      expect(stitchErrorMessage(tooDeep.error)).toContain('child');
    }

    // The bound is configurable, and the config default matches the constant.
    const raised = sanitizeToolArgs(tool, nest(40), { maxArgsDepth: 100 });
    expect(raised.isOk()).toBe(true);

    // Arrays count toward the depth, so a "flat" list of 1000 nested arrays is
    // still refused rather than walked to the stack limit.
    let deepArray: unknown = 'leaf';
    for (let i = 0; i < 30; i += 1) deepArray = [deepArray];
    expect(sanitizeToolArgs(tool, { opts: { deepArray } }).isErr()).toBe(true);

    // A cyclic argument tree terminates instead of looping forever — the walk
    // is iterative with a visit set, so it cannot be defeated by a cycle.
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const cyclicResult = sanitizeToolArgs(tool, { opts: { cyclic } });
    expect(cyclicResult.isOk()).toBe(true);
  });

  it('loop validates before execute', async () => {
    const ran: string[] = [];

    /** Two scripted turns: one tool call, then a stop. */
    const runLoop = async (
      validator: ReturnType<typeof createToolValidator> | undefined,
      tool: ToolDefinition,
      args: Record<string, unknown>
    ): Promise<{ content: string; toolRan: boolean }> => {
      const first = new MockProvider({
        script: [
          { kind: 'tool_call', toolCall: { id: 'c1', name: tool.name, arguments: args } },
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
        chat: (...a: Parameters<MockProvider['chat']>) =>
          (turn++ === 0 ? first : second).chat(...a),
        countTokens: (messages: ChatMessage[]) =>
          messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
        isRetryable: () => false,
      };
      const result = await runToolLoop(provider, [tool], [{ role: 'user', content: 'go' }], {
        maxIterations: 3,
        policy: defaultAutonomyPolicy(),
        // `exactOptionalPropertyTypes` forbids passing `undefined` explicitly,
        // so an absent validator is expressed by omitting the key.
        ...(validator !== undefined ? { validation: validator } : {}),
      });
      expect(result.isOk()).toBe(true);
      const toolMsg = result._unsafeUnwrap().messages.find(m => m.role === 'tool');
      return { content: toolMsg?.content ?? '', toolRan: ran.length > 0 };
    };

    const safe = testTool('safe', async () => {
      ran.push('safe');
      return ok('fine');
    });

    // 1. Clean args pass through and the tool runs.
    ran.length = 0;
    const clean = await runLoop(createToolValidator(), safe, { path: 'src/index.ts' });
    expect(clean.toolRan).toBe(true);
    expect(clean.content).toContain('fine');

    // 2. A proto-polluting key stops the call BEFORE execute. This is the
    //    assertion the phase exists for: the tool must not run at all.
    ran.length = 0;
    const hostile = testTool(
      'hostile',
      async () => {
        ran.push('hostile');
        return ok('should not happen');
      },
      { opts: z.record(z.string(), z.unknown()) }
    );
    const blocked = await runLoop(
      createToolValidator(),
      hostile,
      JSON.parse('{"opts":{"__proto__":{"polluted":"yes"}}}')
    );
    expect(blocked.toolRan).toBe(false);
    expect(blocked.content).toContain('prototype-polluting key');
    expect((Object.prototype as unknown as Record<string, unknown>)['polluted']).toBeUndefined();

    // 3. A traversal is rejected before execute too.
    ran.length = 0;
    const traversal = await runLoop(createToolValidator(), safe, { path: '../../etc/passwd' });
    expect(traversal.toolRan).toBe(false);
    expect(traversal.content).toContain('escapes the repository root');

    // 4. The result is checked AFTER execute: the tool runs, and the loop
    //    reports the oversized result instead of feeding it to the model. The
    //    `ran` push is what proves the ordering � a result check that ran
    //    first would leave `ran` empty.
    ran.length = 0;
    const huge = testTool('huge', async () => {
      ran.push('huge');
      return ok('x'.repeat(2_000_000));
    });
    const oversized = await runLoop(createToolValidator(), huge, { path: 'a.ts' });
    expect(oversized.toolRan).toBe(true);
    expect(oversized.content).toContain('TOOL_RESULT_TOO_LARGE');
    expect(oversized.content.length).toBeLessThan(1_000_000);

    // 5. With no validator injected the loop behaves exactly as it did through
    //    P-157 — the pre-P-158 path is not disturbed.
    ran.length = 0;
    const unvalidated = await runLoop(undefined, hostile, {
      opts: JSON.parse('{"__proto__":{"polluted":"yes"}}'),
    });
    expect(unvalidated.toolRan).toBe(true);
  });

  it('records validation failures in audit', async () => {
    const db = makeAdapter();
    const audit = new AiAuditLog(db, { flushEvery: 1 });
    const validator = createToolValidator({ audit });

    const tool = testTool('audited', async () => ok('unused'), {
      opts: z.record(z.string(), z.unknown()),
    });

    const proto = sanitizeToolArgs(tool, JSON.parse('{"opts":{"__proto__":{}}}'));
    expect(proto.isErr()).toBe(true);
    if (proto.isErr()) validator.audit(proto.error, tool.name, 'args');

    const traversal = sanitizeToolArgs(tool, { opts: { path: '../x' } });
    expect(traversal.isErr()).toBe(true);
    if (traversal.isErr()) validator.audit(traversal.error, tool.name, 'args');

    const deep = sanitizeToolArgs(
      tool,
      (() => {
        let node: Record<string, unknown> = { leaf: 1 };
        for (let i = 0; i < 40; i += 1) node = { child: node };
        return { opts: node };
      })()
    );
    expect(deep.isErr()).toBe(true);
    if (deep.isErr()) validator.audit(deep.error, tool.name, 'args');

    const tooBig = validateToolResult(tool, ok('x'.repeat(2_000_000)));
    expect(tooBig.isErr()).toBe(true);
    if (tooBig.isErr()) validator.audit(tooBig.error, tool.name, 'result');

    const rows = await audit.query({ task: VALIDATION_TASK });
    expect(rows).toHaveLength(4);

    // The four checks are distinguishable by `kind`, which is the point of
    // auditing: "is the model emitting traversal?" must be answerable without
    // grepping prose.
    const kinds = rows.map(r => r.validation?.kind).sort();
    expect(kinds).toEqual(['depth_exceeded', 'path_traversal', 'proto_pollution', 'too_large']);

    // The stage records which side of `execute` rejected, and the tool is
    // named on every row.
    const argRows = rows.filter(r => r.validation?.stage === 'args');
    expect(argRows).toHaveLength(3);
    expect(rows.filter(r => r.validation?.stage === 'result')).toHaveLength(1);
    for (const row of rows) {
      expect(row.validation?.tool).toBe('audited');
      expect(row.validation?.reason.length ?? 0).toBeGreaterThan(0);
      // A validation check calls no model: no fabricated cost or latency.
      expect(row.inputTokens).toBe(0);
      expect(row.costUsd).toBe(0);
      expect(row.latencyMs).toBe(0);
    }

    // The oversized row carries the numbers, so the UI can explain itself.
    const bigRow = rows.find(r => r.validation?.kind === 'too_large');
    expect(bigRow?.validation?.size).toBeGreaterThan(MAX_TOOL_RESULT_BYTES);
    expect(bigRow?.validation?.max).toBe(MAX_TOOL_RESULT_BYTES);

    // An error that is not a validation rejection is not audited as one: the
    // bridge filters on the two codes it owns rather than logging everything.
    auditValidationFailure(audit, 'x', { code: 'LOOP_LIMIT', message: 'nope' }, 'args');
    expect((await audit.query({ task: VALIDATION_TASK })).length).toBe(4);

    // No audit sink at all still validates — losing a row beats losing the check.
    const noAudit = createToolValidator();
    expect(noAudit.validateToolResult(tool, ok('a'.repeat(2_000_000))).isErr()).toBe(true);
    expect(() => {
      noAudit.audit(
        { code: 'TOOL_RESULT_TOO_LARGE', message: 'm', size: 1, max: 0 },
        'x',
        'result'
      );
    }).not.toThrow();

    // The round-trip helper reports whichever half failed.
    const roundTrip = validateToolCall(tool, { opts: { path: '../x' } }, ok('fine'), {
      maxResultBytes: 10,
    });
    expect(roundTrip.isErr()).toBe(true);
    if (roundTrip.isErr())
      expect(stitchErrorMessage(roundTrip.error)).toContain('escapes the repository root');
    expect(validateToolCall(tool, { opts: { path: 'a.ts' } }, ok('fine')).isOk()).toBe(true);
  });
});

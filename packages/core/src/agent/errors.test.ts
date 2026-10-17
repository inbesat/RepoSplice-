// P-163 tests: error classification and recovery.
//
// The table is the product here, so the tests are organised around properties
// that must hold for EVERY code rather than spot-checking a few:
//
//   - coverage: all 48 codes classify, and none of them is unhandled
//   - no `fatal` is misfiled: nothing recoverable is called fatal, and nothing
//     fatal is called recoverable
//   - every code has a friendly message, because CLI P-201 and web P-228 render
//     from it and a blank panel is not an error message
//
// The loop test is here rather than in the reasoning suite because the property
// under test is a crash: a tool that throws instead of returning a Result must
// not take the run down.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { type Result } from 'neverthrow';
import {
  classifyError,
  handleError,
  friendlyError,
  fromUnknownThrow,
  CLASSIFIED_CODES,
} from './errors.js';
import { ReasoningStream } from './reasoning.js';
import { AgentStateMachine } from './state.js';
import { defaultAutonomyPolicy } from './policy.js';
import { runToolLoop } from '../ai/loop.js';
import { MockProvider } from '../ai/mock.js';
import { STITCH_ERROR_CODES, type StitchError, type StitchErrorCode } from '../result/index.js';
import type { ProviderError, ToolDefinition, ChatMessage } from '../index.js';

/** Build a `StitchError` of a given code with the minimum fields that code needs. */
function codeErr(code: StitchErrorCode): StitchError {
  // The union's per-code shapes differ; the handler only ever reads `code` and
  // `message`, and a test double that carries both is honest about that.
  return { code, message: `${code} happened` } as StitchError;
}

function providerErr(over: Partial<ProviderError> = {}): ProviderError {
  return {
    kind: 'unknown',
    message: 'provider said no',
    providerName: 'openai',
    retryable: false,
    ...over,
  };
}

describe('P-163 agent error handling', () => {
  it('classifies provider/tool/auth/sandbox/fatal', () => {
    // The spec's five named classes, each from a real code.
    expect(classifyError(providerErr({ kind: 'rate_limit', retryable: true })).cls).toBe(
      'retryable'
    );
    expect(classifyError(codeErr('AI_PROVIDER_ERROR')).cls).toBe('provider');
    expect(classifyError(codeErr('TOOL_DENIED')).cls).toBe('tool');
    expect(classifyError(codeErr('AUTH_ERROR')).cls).toBe('auth');
    expect(classifyError(codeErr('SANDBOX_UNAVAILABLE')).cls).toBe('sandbox');
    expect(classifyError(codeErr('GIT_ERROR')).cls).toBe('git');
    expect(classifyError(codeErr('CONFIG_ERROR')).cls).toBe('config');
    expect(classifyError(codeErr('INTERNAL')).cls).toBe('fatal');

    // Acceptance: `retryable` is retryable AND recoverable.
    const retryable = classifyError(codeErr('RATE_LIMIT'));
    expect(retryable.cls).toBe('retryable');
    expect(retryable.retryable).toBe(true);
    expect(retryable.recoverable).toBe(true);

    // Acceptance: `auth` is recoverable; `fatal` and `config` are not.
    expect(classifyError(codeErr('AUTH_FAILED')).recoverable).toBe(true);
    expect(classifyError(codeErr('CONFIG_ERROR')).recoverable).toBe(false);
    expect(classifyError(codeErr('INTERNAL')).recoverable).toBe(false);

    // A provider error's OWN `retryable` flag is honoured, not just its kind:
    // a rate limit the provider says is not retryable must not be retried.
    expect(classifyError(providerErr({ kind: 'rate_limit', retryable: false })).retryable).toBe(
      false
    );
    // A provider `auth` kind maps to the auth class, which is the *second* auth
    // path — distinct from the AUTH_* codes but needing the same remedy.
    expect(classifyError(providerErr({ kind: 'auth' })).cls).toBe('auth');
    // An invalid request is a configuration problem, not a transient one.
    expect(classifyError(providerErr({ kind: 'invalid_request' })).cls).toBe('config');

    // THE REASON THIS PHASE IS AN EXPLICIT TABLE. `GIT_ERROR` and
    // `GITHUB_API_ERROR` share a four-letter prefix and need different
    // recoveries, so a `startsWith` classifier would get one of them wrong.
    expect(classifyError(codeErr('GIT_ERROR')).cls).toBe('git');
    expect(classifyError(codeErr('GITHUB_API_ERROR')).cls).toBe('provider');
    expect(codeErr('GITHUB_API_ERROR').code.startsWith('GIT')).toBe(true);

    // COVERAGE: every code that exists classifies, and nothing is unhandled.
    // The spec's six prefix rules covered 11 of 48; the rest would all have been
    // `fatal`, which is why the table is explicit.
    expect(CLASSIFIED_CODES).toEqual(STITCH_ERROR_CODES);
    for (const code of STITCH_ERROR_CODES) {
      const classified = classifyError(codeErr(code));
      expect(classified.cls, code).toBeTruthy();
      expect(classified.source, code).toBe(code);
    }

    // Nothing recoverable is filed as fatal, and every fatal really is one. A
    // rate limit called "fatal" would strand a job that a retry would finish.
    const recoverableCodes = STITCH_ERROR_CODES.filter(c => !classifyError(codeErr(c)).recoverable);
    expect(recoverableCodes.sort()).toEqual(
      [
        'COMPLIANCE_VIOLATION',
        'CONFIG_ERROR',
        // P-243 added CONFIG_INVALID and classified it `config`: a config that
        // failed its own schema is repaired by a human editing a field, not by a
        // retry that would merge the same invalid value again.
        'CONFIG_INVALID',
        'COST_LIMIT',
        'DEPENDENCY_CONFLICT',
        'DEPS_PARSE_ERROR',
        'ECOSYSTEM_MISMATCH',
        'FORBIDDEN',
        'INVALID_PROVIDER',
        'LICENSE_SCAN_FAILED',
        'LICENSE_VIOLATION',
        'LOCKFILE_GENERATION_FAILED',
        'LOCKFILE_NOT_CREATED',
        'LOOP_LIMIT',
        'MODEL_INCAPABLE',
        'PROMPT_MISSING_VAR',
        'PROMPT_NOT_FOUND',
        'SCANCODE_MISSING',
        // P-183 added SBOM_INVALID and classified it `fatal`: a document that
        // failed its own schema is a composition defect, so a retry reproduces
        // it rather than resolving it.
        'SBOM_INVALID',
        // P-164 added TOKEN_LIMIT and classified it `config`: reaching a token
        // budget needs a human to raise it, so it is not recoverable by retry.
        'TOKEN_LIMIT',
        'UNKNOWN_LICENSE',
        'UNKNOWN_MODEL',
        'UNSUPPORTED_ECOSYSTEM',
        'ABORTED',
        'FILE_NOT_FOUND',
        'INTERNAL',
        'NOT_FOUND',
        'USER_CANCELLED',
        'USER_TIMEOUT',
      ].sort()
    );
    // The codes the spec would have misfiled as fatal, now correctly recoverable.
    for (const c of ['RATE_LIMIT', 'NETWORK', 'SCANCODE_FAILED', 'DOCKER_ERROR'] as const) {
      expect(classifyError(codeErr(c)).recoverable, c).toBe(true);
    }
    // A terminal outcome is not a bug, and must not read like one.
    for (const c of ['ABORTED', 'USER_CANCELLED', 'USER_TIMEOUT', 'LOOP_LIMIT'] as const) {
      const text = friendlyError(codeErr(c)).toLowerCase();
      expect(text, c).not.toContain('bug');
    }
  });

  it('routes auth to ask', async () => {
    const budget = { retriesLeft: 0, failoversLeft: 0 };
    // Auth routes to `ask` regardless of budget: a missing key is fixed by a
    // human, not by retrying the same unauthenticated request.
    for (const code of ['AUTH_ERROR', 'AUTH_FAILED'] as const) {
      const decision = await handleError(codeErr(code), budget);
      expect(decision.isOk()).toBe(true);
      if (decision.isOk()) {
        expect(decision._unsafeUnwrap().action).toBe('ask');
        expect(decision._unsafeUnwrap().cls).toBe('auth');
        expect(decision._unsafeUnwrap().message.length).toBeGreaterThan(0);
      }
    }
    // The provider's own auth kind takes the same route.
    const viaProvider = await handleError(providerErr({ kind: 'auth' }), budget);
    expect(viaProvider._unsafeUnwrap().action).toBe('ask');
  });

  it('retry to failover to abort', async () => {
    // The chain is a pure function of the remaining budget, so it terminates by
    // construction: every step consumes budget and none of them can loop.
    const rateLimit = codeErr('RATE_LIMIT');

    const first = await handleError(rateLimit, { retriesLeft: 2, failoversLeft: 1 });
    expect(first._unsafeUnwrap().action).toBe('retry');

    // Retries exhausted, a provider left: fail over.
    const second = await handleError(rateLimit, { retriesLeft: 0, failoversLeft: 1 });
    expect(second._unsafeUnwrap().action).toBe('failover');

    // Everything exhausted: abort, and the chain stops.
    const third = await handleError(rateLimit, { retriesLeft: 0, failoversLeft: 0 });
    expect(third._unsafeUnwrap().action).toBe('abort');
    // Re-asking with the same exhausted budget stays aborted. Termination.
    const fourth = await handleError(rateLimit, { retriesLeft: 0, failoversLeft: 0 });
    expect(fourth._unsafeUnwrap().action).toBe('abort');

    // A provider error skips retry (the provider already refused once) and goes
    // straight to failover, then abort.
    const providerDown = codeErr('AI_PROVIDER_ERROR');
    expect(
      (await handleError(providerDown, { retriesLeft: 5, failoversLeft: 1 }))._unsafeUnwrap().action
    ).toBe('failover');
    expect(
      (await handleError(providerDown, { retriesLeft: 5, failoversLeft: 0 }))._unsafeUnwrap().action
    ).toBe('abort');

    // Terminal classes ignore the budget entirely: no amount of retrying fixes a
    // configuration mistake.
    for (const code of ['CONFIG_ERROR', 'INTERNAL', 'NOTHING_TO_UNDO'] as const) {
      const decision = await handleError(codeErr(code), { retriesLeft: 99, failoversLeft: 99 });
      const action = decision._unsafeUnwrap().action;
      expect(['abort', 'continue'], code).toContain(action);
    }
  });

  it('continues on tool error', async () => {
    const budget = { retriesLeft: 5, failoversLeft: 5 };
    // A tool error is the model's problem to fix, so the loop continues rather
    // than retrying or failing — the tool never ran successfully and a retry
    // would send the same bad input again.
    for (const code of [
      'TOOL_DENIED',
      'TOOL_ARGS_VALIDATION',
      'TOOL_ARGS_INVALID_JSON',
      'TOOL_RESULT_TOO_LARGE',
      'UNKNOWN_TOOL',
      'SELECT_PATH_NOT_FOUND',
      'ILLEGAL_TRANSITION',
      'NOTHING_TO_UNDO',
      'TOOL_CALLING_BLOCKED',
    ] as const) {
      const decision = await handleError(codeErr(code), budget);
      expect(decision._unsafeUnwrap().action, code).toBe('continue');
      expect(decision._unsafeUnwrap().cls, code).toBe('tool');
    }

    // A git error also continues — the model is told and can adapt — rather than
    // consuming a retry budget it would not benefit from.
    expect((await handleError(codeErr('GIT_ERROR'), budget))._unsafeUnwrap().action).toBe(
      'continue'
    );
  });

  it('no crash on unknown', async () => {
    // An arbitrary throw becomes a terminal decision rather than an exception.
    const decision = fromUnknownThrow(new Error('kaboom'));
    expect(decision.action).toBe('abort');
    expect(decision.cls).toBe('fatal');
    expect(decision.message).toContain('kaboom');

    // Non-Error throws are handled too — `throw 'string'` is legal JS.
    expect(fromUnknownThrow('a string').message).toContain('a string');
    expect(fromUnknownThrow(undefined).message.length).toBeGreaterThan(0);

    // The loop must survive a tool that throws despite its `Result` contract.
    // This is the acceptance criterion, tested against the real loop.
    const stream = new ReasoningStream();
    const machine = new AgentStateMachine();
    const boom: ToolDefinition = {
      name: 'boom',
      description: 'throws instead of returning',
      schema: { path: z.string() },
      autonomy: 'auto',
      execute: async (): Promise<Result<unknown, StitchError>> => {
        throw new Error('tool exploded');
      },
    };
    const first = new MockProvider({
      script: [
        { kind: 'tool_call', toolCall: { id: 'c1', name: 'boom', arguments: { path: 'a' } } },
        { kind: 'finish', finishReason: 'tool_calls' },
      ],
    });
    const second = new MockProvider({
      script: [
        { kind: 'text', text: 'recovered' },
        { kind: 'finish', finishReason: 'stop', usage: { input: 1, output: 1, total: 2 } },
      ],
    });
    let turn = 0;
    const provider = {
      name: 'mock',
      model: 'mock-model',
      provider: 'mock' as const,
      id: 'mock/mock-model',
      chat: (...a: Parameters<MockProvider['chat']>) => (turn++ === 0 ? first : second).chat(...a),
      countTokens: (messages: ChatMessage[]) =>
        messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0),
      isRetryable: () => false,
    };

    const result = await runToolLoop(provider, [boom], [{ role: 'user', content: 'go' }], {
      maxIterations: 3,
      policy: defaultAutonomyPolicy(),
      stateMachine: machine,
      reasoning: stream,
      errorRouter: { fromUnknownThrow },
    });
    // The loop survived, told the model, and finished on the next turn.
    expect(result.isOk()).toBe(true);
    const toolMsg = result._unsafeUnwrap().messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toContain('tool exploded');
    // It is visible in the reasoning feed as a failure, not a silent success.
    const results = stream.dump().filter(e => e.type === 'tool_result') as Array<{
      ok: boolean;
      summary: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.summary).toContain('tool exploded');
    expect(machine.state).toBe('done');

    // With no router wired the loop still does not throw: it reports the
    // failure in the same shape.
    const bare = await runToolLoop(provider, [boom], [{ role: 'user', content: 'go' }], {
      maxIterations: 3,
      policy: defaultAutonomyPolicy(),
    });
    expect(bare.isOk()).toBe(true);
  });

  it('friendly message mapping', () => {
    // Every code gets a message, because CLI P-201 and web P-228 render from it.
    // A blank panel is not an error message.
    for (const code of STITCH_ERROR_CODES) {
      const message = friendlyError(codeErr(code));
      expect(message.length, code).toBeGreaterThan(20);
      expect(message, code).toContain(message.trim().slice(0, 10));
      // Never a bare code, never an empty template.
      expect(message, code).not.toBe(code);
      expect(message, code).not.toContain('undefined');
      // The message is a sentence with a remedy, not a restatement.
      expect(message, code).toMatch(/[.!]$/);
    }

    // Spot-check that the advice is actually actionable rather than generic.
    expect(friendlyError(codeErr('SANDBOX_UNAVAILABLE'))).toMatch(/docker|fallback/i);
    expect(friendlyError(codeErr('AUTH_ERROR'))).toMatch(/token|credential|auth/i);
    expect(friendlyError(codeErr('CONFIG_ERROR'))).toMatch(/config|field/i);
    expect(friendlyError(codeErr('RATE_LIMIT'))).toMatch(/rate limit|wait/i);
    expect(friendlyError(codeErr('TOOL_DENIED'))).toMatch(/declined|denied|another approach/i);

    // A provider error renders its own message with its provider and kind,
    // because the table describes codes and not provider wording.
    const fromProvider = friendlyError(providerErr({ kind: 'rate_limit', message: 'slow down' }));
    expect(fromProvider).toContain('openai');
    expect(fromProvider).toContain('rate_limit');
    expect(fromProvider).toContain('slow down');

    // The message and the classification come from ONE table, so a code cannot
    // have a class but no message.
    for (const code of STITCH_ERROR_CODES) {
      const classified = classifyError(codeErr(code));
      const message = friendlyError(codeErr(code));
      expect(message.length, `${code} / ${classified.cls}`).toBeGreaterThan(20);
    }
  });
});

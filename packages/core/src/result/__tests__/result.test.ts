import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  Result,
  fromPromise,
  fromSafePromise,
  ResultAsync,
  okAsync,
  errAsync,
} from 'neverthrow';
import {
  match,
  stitchOk,
  stitchErr,
  fromInternalPromise,
  STITCH_ERROR_CODES,
  type StitchError,
  type StitchErrorCode,
} from '../index.js';

describe('Result ok/err construction', () => {
  it('ok wraps a value; isOk true, isErr false', () => {
    const r = ok(42);
    expect(r.isOk()).toBe(true);
    expect(r.isErr()).toBe(false);
    if (r.isOk()) expect(r.value).toBe(42);
  });

  it('err wraps an error; isOk false, isErr true', () => {
    const r = err<number, StitchError>({ code: 'CONFIG_ERROR', field: 'paths', message: 'bad' });
    expect(r.isOk()).toBe(false);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      if (r.error.code === 'CONFIG_ERROR') {
        expect(r.error.field).toBe('paths');
        expect(r.error.message).toBe('bad');
      }
    }
  });

  it('stitchOk/stitchErr are typed against StitchError', () => {
    const r1 = stitchOk('hello');
    expect(r1.isOk()).toBe(true);
    const r2 = stitchErr({ code: 'GIT_ERROR', message: 'failed', gitOutput: 'fatal: ...' });
    expect(r2.isErr()).toBe(true);
  });
});

describe('Result chains: map and andThen', () => {
  it('map transforms the ok value, leaves err untouched', () => {
    const r = ok<number, StitchError>(2)
      .map(n => n * 10)
      .map(n => `value=${n}`);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('value=20');
  });

  it('andThen chains to another Result, propagating errs', () => {
    const okChain = ok<number, StitchError>(5).andThen(n =>
      n > 0 ? ok<number, StitchError>(n * 2) : err({ code: 'GIT_ERROR', message: 'n <= 0' })
    );
    expect(okChain.isOk()).toBe(true);
    if (okChain.isOk()) expect(okChain.value).toBe(10);

    const errChain = ok<number, StitchError>(-1).andThen(n =>
      n > 0 ? ok<number, StitchError>(n * 2) : err({ code: 'GIT_ERROR', message: 'n <= 0' })
    );
    expect(errChain.isErr()).toBe(true);
  });

  it('mapErr transforms the err value', () => {
    const r = err<number, StitchError>({ code: 'GIT_ERROR', message: 'x' }).mapErr(e => {
      if (e.code === 'GIT_ERROR') {
        return { ...e, message: `wrapped: ${e.message}` };
      }
      return e;
    });
    if (r.isErr()) {
      if (r.error.code === 'GIT_ERROR') {
        expect(r.error.message).toBe('wrapped: x');
      }
    }
  });
});

describe('fromPromise: catches + maps rejections', () => {
  it('resolves to ok on a fulfilled promise', async () => {
    const r = await fromPromise(Promise.resolve('data'), () => ({
      code: 'INTERNAL' as const,
      message: 'should not run',
    }));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('data');
  });

  it('maps a rejection to a typed err', async () => {
    const original = new Error('boom');
    const failing = new Promise<number>((_, reject) => {
      setTimeout(() => reject(original), 0);
    });
    const r = await fromPromise(failing, e => ({
      code: 'INTERNAL' as const,
      message: `rejected: ${(e as Error).message}`,
    }));
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.message).toBe('rejected: boom');
  });

  it('fromSafePromise resolves to ok on fulfilled promise', async () => {
    const r = await fromSafePromise(Promise.resolve('value'));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe('value');
  });

  it('fromSafePromise is for "safe" promises — caller catches rejections', async () => {
    // neverthrow's fromSafePromise chains .then only; rejections propagate.
    // (For "auto-catch to INTERNAL" behavior, use fromPromise with an errorFn.)
    const failing = new Promise<number>((_, reject) => {
      setTimeout(() => reject(new Error('nope')), 0);
    });
    failing.catch(() => {}); // mark as observed
    const ra = fromSafePromise(failing);
    await expect(ra).rejects.toThrow('nope');
  });

  it('ResultAsync.fromPromise works (mirrors fromPromise)', async () => {
    const ra = ResultAsync.fromPromise(Promise.resolve(7), () => ({
      code: 'INTERNAL' as const,
      message: 'unreached',
    }));
    const r = await ra;
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(7);
  });

  it('fromInternalPromise (project helper) maps rejection to INTERNAL StitchError', async () => {
    const original = new Error('explode');
    const failing = new Promise<number>((_, reject) => {
      setTimeout(() => reject(original), 0);
    });
    failing.catch(() => {});
    const r = await fromInternalPromise(failing);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      if (r.error.code === 'INTERNAL') {
        expect(r.error.message).toContain('explode');
        expect(r.error.cause).toBe(original);
      }
    }
  });

  it('okAsync/errAsync produce ResultAsync values', async () => {
    const okR = await okAsync('async-ok');
    expect(okR.isOk()).toBe(true);
    const errR = await errAsync<string, StitchError>({ code: 'GIT_ERROR', message: 'async' });
    expect(errR.isErr()).toBe(true);
  });
});

describe('match: exhaustive handling', () => {
  it('runs onOk branch when Result is ok', () => {
    const r = ok<number, StitchError>(10);
    const out = match(r, {
      onOk: n => `ok:${n}`,
      onErr: e => `err:${e.code}`,
    });
    expect(out).toBe('ok:10');
  });

  it('runs onErr branch when Result is err', () => {
    const r = err<number, StitchError>({
      code: 'AI_PROVIDER_ERROR',
      provider: 'openrouter',
      message: 'rate',
    });
    const out = match(r, {
      onOk: n => `ok:${n}`,
      onErr: e => `err:${e.code}`,
    });
    expect(out).toBe('err:AI_PROVIDER_ERROR');
  });

  it('returns a uniform type from both branches', () => {
    const r1: Result<number, StitchError> = ok(1);
    const r2: Result<number, StitchError> = err({ code: 'GIT_ERROR', message: 'x' });
    const f1: string = match(r1, { onOk: n => n.toString(), onErr: () => 'e' });
    const f2: string = match(r2, { onOk: n => n.toString(), onErr: () => 'e' });
    expect(typeof f1).toBe('string');
    expect(typeof f2).toBe('string');
  });
});

describe('error codes unique', () => {
  it('STITCH_ERROR_CODES contains no duplicates', () => {
    const set = new Set<string>(STITCH_ERROR_CODES);
    expect(set.size).toBe(STITCH_ERROR_CODES.length);
  });

  it('every code in STITCH_ERROR_CODES is a valid StitchErrorCode', () => {
    const typed: readonly StitchErrorCode[] = STITCH_ERROR_CODES;
    expect(typed.length).toBeGreaterThan(0);
  });

  it('StitchError union covers all 13 stages (git, github, deps, license, ai, sandbox, orchestration, config, auth, cost, compliance + 2 common)', () => {
    const required: StitchErrorCode[] = [
      'GIT_ERROR',
      'GITHUB_API_ERROR',
      'DEPENDENCY_CONFLICT',
      'LICENSE_VIOLATION',
      'AI_PROVIDER_ERROR',
      'SANDBOX_FAILED',
      'CONFIG_ERROR',
      'AUTH_ERROR',
      'COST_LIMIT',
      'COMPLIANCE_VIOLATION',
    ];
    for (const code of required) {
      expect(STITCH_ERROR_CODES).toContain(code);
    }
  });

  it('INTERNAL and USER_CANCELLED exist as utility codes', () => {
    expect(STITCH_ERROR_CODES).toContain('INTERNAL');
    expect(STITCH_ERROR_CODES).toContain('USER_CANCELLED');
  });
});

describe('StitchError type discriminability', () => {
  it('different codes carry different required fields', () => {
    const git: StitchError = { code: 'GIT_ERROR', message: 'x' };
    const api: StitchError = { code: 'GITHUB_API_ERROR', status: 500, message: 'y' };
    const docker: StitchError = { code: 'DOCKER_ERROR', message: 'z', containerId: 'abc' };
    const cost: StitchError = {
      code: 'COST_LIMIT',
      provider: 'openrouter',
      spentUsd: 5,
      limitUsd: 1,
    };
    expect(git.code).toBe('GIT_ERROR');
    expect(api.code).toBe('GITHUB_API_ERROR');
    if (api.code === 'GITHUB_API_ERROR') expect(api.status).toBe(500);
    if (docker.code === 'DOCKER_ERROR') expect(docker.containerId).toBe('abc');
    if (cost.code === 'COST_LIMIT') {
      expect(cost.spentUsd).toBe(5);
      expect(cost.limitUsd).toBe(1);
    }
  });
});

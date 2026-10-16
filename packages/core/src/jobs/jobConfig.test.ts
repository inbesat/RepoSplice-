// P-243 — per-job config tests.
//
// `resolveJobConfig` is a pure function of plain objects, so every case here needs
// no clock, no filesystem and no bus except in the emit test. The hash cases assert
// BOTH directions that matter: it moves when a knob moves, and it stays put when a
// credential rotates — which is the whole reason `project` is outside the hashed
// subset (P-240 refuses a resume when the hash differs).
//
// The five required scenarios from the phase spec:
//
//   it('precedence')  it('invalid errors')  it('freeze')  it('hash')  it('redacted emit')

import { describe, it, expect } from 'vitest';
import { defaultConfig, type Config } from '../config/schema.js';
import { Bus } from '../events/bus.js';
import type { JobConfigResolvedPayload } from '../events/topics.js';
import { STITCH_ERROR_CODES } from '../result/index.js';
import { REDACTED } from '../sandbox/secrets.js';
import {
  PIPELINE_RELEVANT_KEYS,
  configHash,
  emitConfigResolved,
  resolveJobConfig,
  section,
  type JobConfig,
  type JobConfigLayer,
} from './jobConfig.js';

/** A project config carrying two credentials, so redaction has something to catch. */
function projectWithSecret(): Config {
  return {
    ...defaultConfig,
    github: { authType: 'pat', token: 'ghp_secret_value' },
    openrouter: { apiKey: 'or_secret_key', defaultModel: 'openrouter/auto' },
  };
}

/** CLI/API flags (P-204/P-192) — the middle precedence layer. */
const FLAGS: JobConfigLayer = {
  outDir: 'out/from-flags',
  ai: { provider: 'openrouter' },
  sandbox: { timeout: 300 },
  progress: { cadence: 500, weights: { sandbox: 0.5, agent: 0.4 } },
  flags: { dryRun: true },
};

/** The API body (P-192) — the highest precedence layer. */
const OVERRIDES: JobConfigLayer = {
  outDir: 'out/from-overrides',
  sandbox: { timeout: 900 },
  flags: { dryRun: false, offline: true },
};

function resolve(layers: { flags?: JobConfigLayer; overrides?: JobConfigLayer } = {}): JobConfig {
  const result = resolveJobConfig({ project: projectWithSecret(), jobId: 'job-1', ...layers });
  if (result.isErr()) expect.fail(`config rejected: ${result.error.code}`);
  return result.value;
}

/**
 * Assert a refusal, and hand back the issue list.
 *
 * `StitchError` is a union, so `.issues` exists only on the `CONFIG_INVALID`
 * member: the code is asserted first and then used to narrow. This is the same
 * shape `sbom.test.ts` uses for `SBOM_INVALID`.
 */
function invalid(result: ReturnType<typeof resolveJobConfig>): {
  issues: { path: string; message: string }[];
  message: string;
} {
  if (result.isOk()) expect.fail('expected the config to be refused');
  expect(result.error.code).toBe('CONFIG_INVALID');
  if (result.error.code !== 'CONFIG_INVALID') expect.fail('expected CONFIG_INVALID');
  return { issues: result.error.issues, message: result.error.message };
}

describe('P-243 per-job config', () => {
  it('precedence', () => {
    const cfg = resolve({ flags: FLAGS, overrides: OVERRIDES });

    // project <- flags <- overrides, per key.
    expect(cfg.outDir).toBe('out/from-overrides'); // overrides beat flags
    expect(cfg.sandbox.timeout).toBe(900); // overrides beat flags
    expect(cfg.ai.provider).toBe('openrouter'); // only flags supplied it
    expect(cfg.flags.offline).toBe(true); // only overrides supplied it
    expect(cfg.flags.dryRun).toBe(false); // `false` beats flags' `true`

    // The merge is DEEP: a layer setting one key of a section does not wipe the
    // rest of that section, which is what keeps the defaults alive.
    expect(cfg.sandbox.verify).toBe(true);
    expect(cfg.ai.stream).toBe(true);
    expect(cfg.progress.cadence).toBe(500);
    expect(section(cfg, 'progress').weights.sandbox).toBe(0.5);
    expect(section(cfg, 'progress').weights.agent).toBe(0.4);
    expect(cfg.ai.budget).toEqual({});

    // The P-200 project block is carried verbatim, so a stage that needs a token or
    // a backend reads it from here rather than re-parsing the project.
    expect(cfg.project.github.token).toBe('ghp_secret_value');
    expect(section(cfg, 'project').sandbox.backend).toBe('docker');

    // Section defaults fill in, so a stage never has to guard for absence.
    expect(cfg.sources).toEqual([]);
    expect(cfg.selection).toEqual({ include: [], exclude: [] });
    expect(cfg.licenses).toEqual({ allow: [], deny: [] });
    expect(cfg.perf).toEqual({});
    expect(section(cfg, 'perf').concurrency).toBeUndefined();
    expect(cfg.jobId).toBe('job-1');

    // Flags alone, with no API body.
    const flagged = resolve({ flags: FLAGS });
    expect(flagged.outDir).toBe('out/from-flags');
    expect(flagged.sandbox.timeout).toBe(300);
    expect(flagged.flags.offline).toBe(false);
    expect(flagged.flags.dryRun).toBe(true);

    // Resolving twice from the same layers gives the same config, so a stage may
    // resolve for itself without the result depending on when it asked.
    const twice = resolve({ flags: FLAGS, overrides: OVERRIDES });
    expect(configHash(twice)).toBe(configHash(cfg));

    // A per-run override of only SOME weights is allowed (the sparse default is
    // what a `partialRecord` buys: a plain record of the stage enum would demand
    // every stage and reject both the default and this layer).
    const sparse = resolve({ flags: { ...FLAGS, progress: { weights: { provenance: 0.25 } } } });
    expect(section(sparse, 'progress').weights).toEqual({ provenance: 0.25 });
    expect(section(sparse, 'progress').cadence).toBe(200); // P-242's default
  });

  it('invalid errors', () => {
    // A required section is missing entirely: zod names the section path.
    const noAi = resolveJobConfig({
      project: projectWithSecret(),
      jobId: 'job-1',
      flags: { outDir: 'out' },
    });
    const noAiError = invalid(noAi);
    expect(noAiError.issues.map(i => i.path)).toContain('ai');
    expect(noAiError.message).toContain('issue');
    expect(noAiError.issues.every(i => i.message.length > 0)).toBe(true);

    // An empty string for a required field is caught, not treated as absent.
    const emptyOut = resolveJobConfig({
      project: projectWithSecret(),
      jobId: 'job-1',
      flags: { outDir: '', ai: { provider: 'openrouter' } },
    });
    expect(invalid(emptyOut).issues.some(i => i.path === 'outDir')).toBe(true);

    // A bad VALUE names the nested path a caller can actually fix.
    const badTimeout = resolveJobConfig({
      project: projectWithSecret(),
      jobId: 'job-1',
      flags: { outDir: 'out', ai: { provider: 'openrouter' }, sandbox: { timeout: -5 } },
    });
    expect(invalid(badTimeout).issues.some(i => i.path === 'sandbox.timeout')).toBe(true);

    // Several bad fields are reported TOGETHER — the reason this code carries an
    // issue list rather than CONFIG_ERROR's single `field`. The wrong TYPE here can
    // only arrive from an untyped API body, so it is cast deliberately.
    const manyBad = resolveJobConfig({
      project: projectWithSecret(),
      jobId: 'job-1',
      flags: {
        outDir: '',
        ai: { provider: 'openrouter' },
        sandbox: { verify: 'yes' } as unknown as JobConfigLayer['sandbox'],
      },
    });
    const manyBadError = invalid(manyBad);
    expect(manyBadError.issues.length).toBeGreaterThan(1);
    expect(manyBadError.message).toContain('issues');

    // An empty job id is refused too — the hash and the event are per-job.
    const noJob = resolveJobConfig({
      project: projectWithSecret(),
      jobId: '',
      flags: { outDir: 'out', ai: { provider: 'openrouter' } },
    });
    expect(invalid(noJob).issues.some(i => i.path === 'jobId')).toBe(true);

    // The code is a first-class member of the unified contract (P-203), not an
    // ad-hoc string — and it is listed exactly once.
    expect(STITCH_ERROR_CODES).toContain('CONFIG_INVALID');
    expect(STITCH_ERROR_CODES.filter(code => code === 'CONFIG_INVALID')).toHaveLength(1);
    expect(STITCH_ERROR_CODES).toContain('CONFIG_ERROR'); // P-009's code is untouched
  });

  it('freeze', () => {
    const project = projectWithSecret();
    const result = resolveJobConfig({
      project,
      jobId: 'job-1',
      flags: FLAGS,
      overrides: OVERRIDES,
    });
    if (result.isErr()) expect.fail(`config rejected: ${result.error.code}`);
    const cfg = result.value;

    // Frozen at every depth a stage might reach for.
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.sandbox)).toBe(true);
    expect(Object.isFrozen(cfg.sources)).toBe(true);
    expect(Object.isFrozen(cfg.selection.include)).toBe(true);
    expect(Object.isFrozen(cfg.progress.weights)).toBe(true);
    expect(Object.isFrozen(cfg.project)).toBe(true);
    expect(Object.isFrozen(cfg.project.github)).toBe(true);

    // A write really does not take. Strict mode, so it rejects rather than failing
    // silently — the stronger of the two behaviours.
    expect(() => Object.assign(cfg, { outDir: 'mutated' })).toThrow();
    expect(() => Object.assign(cfg.sandbox, { timeout: 1 })).toThrow();
    expect(cfg.outDir).toBe('out/from-overrides');
    expect(cfg.sandbox.timeout).toBe(900);

    // The CALLER's own config object is untouched: zod re-constructs the tree, so
    // freezing the result cannot freeze someone else's project config (which a
    // long-lived process may still be reading).
    expect(Object.isFrozen(project)).toBe(false);
    expect(Object.isFrozen(project.github)).toBe(false);
    expect(project.github.token).toBe('ghp_secret_value');
  });

  it('hash', () => {
    const cfg = resolve({ flags: FLAGS, overrides: OVERRIDES });
    const hash = configHash(cfg);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // STABLE: an independently resolved but equal config hashes identically, so a
    // re-run of the same job is resumable (P-240 compares exactly this string).
    expect(configHash(resolve({ flags: FLAGS, overrides: OVERRIDES }))).toBe(hash);

    // Stable across KEY ORDER too: the weights map is built in the opposite order
    // here, and canonical JSON sorts keys, so the hashes must still agree.
    const reordered = resolve({
      flags: {
        flags: { dryRun: true },
        progress: { weights: { agent: 0.4, sandbox: 0.5 }, cadence: 500 },
        sandbox: { timeout: 300 },
        ai: { provider: 'openrouter' },
        outDir: 'out/from-flags',
      },
      overrides: {
        flags: { offline: true, dryRun: false },
        sandbox: { timeout: 900 },
        outDir: 'out/from-overrides',
      },
    });
    expect(configHash(reordered)).toBe(hash);

    // SENSITIVE to anything the pipeline reads.
    const slower = resolve({
      flags: FLAGS,
      overrides: { ...OVERRIDES, sandbox: { timeout: 901 } },
    });
    expect(configHash(slower)).not.toBe(hash);
    const moved = resolve({ flags: FLAGS, overrides: { ...OVERRIDES, outDir: 'out/elsewhere' } });
    expect(configHash(moved)).not.toBe(hash);
    const offline = resolve({
      flags: FLAGS,
      overrides: { ...OVERRIDES, flags: { offline: true, dryRun: true } },
    });
    expect(configHash(offline)).not.toBe(hash);
    const reweighted = resolve({
      flags: { ...FLAGS, progress: { cadence: 500, weights: { sandbox: 0.9, agent: 0.4 } } },
      overrides: OVERRIDES,
    });
    expect(configHash(reweighted)).not.toBe(hash);

    // INSENSITIVE to a credential rotation — the reason `project` is excluded from
    // the hashed subset. A rotated token must not invalidate a resumable job.
    const rotated = resolveJobConfig({
      project: {
        ...defaultConfig,
        github: { authType: 'pat', token: 'ghp_rotated_something_else' },
        openrouter: { apiKey: 'or_rotated_key', defaultModel: 'openrouter/auto' },
      },
      jobId: 'job-1',
      flags: FLAGS,
      overrides: OVERRIDES,
    });
    if (rotated.isErr()) expect.fail(`config rejected: ${rotated.error.code}`);
    expect(rotated.value.project.github.token).toBe('ghp_rotated_something_else');
    expect(configHash(rotated.value)).toBe(hash);

    // And the subset really is DECLARED, rather than being "everything except the
    // fields I happened to remember to exclude".
    expect(PIPELINE_RELEVANT_KEYS).not.toContain('project');
    expect(PIPELINE_RELEVANT_KEYS).toContain('sandbox');
  });

  it('redacted emit', () => {
    const cfg = resolve({ flags: FLAGS, overrides: OVERRIDES });
    const bus = new Bus({ now: () => '2026-10-16T00:00:00.000Z' });
    const seen: JobConfigResolvedPayload[] = [];
    bus.subscribe('job.config-resolved', payload => seen.push(payload));

    const envelope = emitConfigResolved(bus, cfg);
    expect(envelope.topic).toBe('job.config-resolved');
    expect(envelope.sequence).toBe(1);
    expect(seen).toHaveLength(1);

    const payload = seen[0] as JobConfigResolvedPayload;
    expect(payload.jobId).toBe('job-1');
    expect(payload.hash).toBe(configHash(cfg));

    // The payload is what a UI or an audit log may render: no credential survives
    // it, at any depth, by NAME (P-206) — not merely "the fields this module knew
    // about" and not a value-pattern match that a rename would slip past.
    const json = JSON.stringify(payload.effectiveCfg);
    expect(json).not.toContain('ghp_secret_value');
    expect(json).not.toContain('or_secret_key');
    expect(json).toContain(REDACTED);
    expect(json).toContain('out/from-overrides');
    expect(json).toContain('openrouter');

    const nested = payload.effectiveCfg as unknown as {
      project: { github: { token: string; authType: string }; openrouter: { apiKey: string } };
    };
    expect(nested.project.github.token).toBe(REDACTED);
    expect(nested.project.openrouter.apiKey).toBe(REDACTED);
    // `isSecretKey` is deliberately OVER-inclusive (P-206's fail-safe direction):
    // `authType` matches the pattern and is redacted even though 'pat' is not a
    // secret. Losing a harmless field is the acceptable side of that trade — the
    // JSON checks above already prove the non-secret parts survive.
    expect(nested.project.github.authType).toBe(REDACTED);

    // The LIVE config is untouched by redaction: it is a copy, not a scrub in place.
    expect(cfg.project.github.token).toBe('ghp_secret_value');
    expect(cfg.project.openrouter.apiKey).toBe('or_secret_key');

    // `job.config-resolved` sits under `job.*`, so P-241's wildcard subscribers (the
    // WS bridge, the job history) receive it without a new subscription each.
    const wild = new Bus({ now: () => '2026-10-16T00:00:00.000Z' });
    const heard: string[] = [];
    wild.subscribe('job.*', (_payload, env) => heard.push(env.topic));
    emitConfigResolved(wild, cfg);
    wild.publish('pipeline.stage', { stage: 'config', from: 'pending', to: 'running' });
    expect(heard).toEqual(['job.config-resolved']);
  });
});

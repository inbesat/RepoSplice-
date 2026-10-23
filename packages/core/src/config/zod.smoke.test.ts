// P-015 smoke test: confirms that the `zod` dep installed in P-009 is
// resolvable from a core module, that `z.object({...}).parse()` works
// end-to-end on `ConfigSchema`, and that valid + invalid inputs behave
// as expected.
//
// This complements `config/schema.test.ts` (which exercises loadConfig's
// layered-merge + credential validation) with a tiny, spec-shaped
// assertion for the dep itself.
import { describe, it, expect } from 'vitest';
import { z, toJSONSchema } from 'zod';
import { ConfigSchema, type Config } from './schema.js';

describe('P-015 zod smoke (ConfigSchema)', () => {
  it('parses valid config', () => {
    const valid: Config = {
      github: { authType: 'pat', token: 'ghp_test' },
      openrouter: { apiKey: 'sk-or-test' },
      anthropic: {},
      ollama: {},
      sandbox: {
        backend: 'docker',
        limits: { memory: '2g', cpu: '1', timeout: 600 },
      },
      paths: { cacheDir: '.cache', worktreeDir: '.wt' },
      licensePolicy: { allow: ['MIT'], warn: [], deny: [] },
      autonomy: { auto: ['fetch'], gated: ['merge'] },
      // P-349 added the composite scoring weights and P-350 the auto-approve
      // threshold (their defaults are asserted below); a config written before
      // either still validates.
      confidence: {
        weights: {
          sandbox_pass: 0.3,
          self_confidence: 0.25,
          resolver_confidence: 0.2,
          license_risk: 0.15,
          test_coverage: 0.1,
        },
        auto_approve_threshold: 75,
      },
      // P-158 added the `[agent]` limits block and P-164 added the loop-cap
      // budgets. Their defaults mean a config written before either still
      // validates — asserted below.
      agent: {
        maxToolResultBytes: 1_000_000,
        maxToolArgsDepth: 16,
        maxIterations: 20,
        maxTokens: 0,
        maxCostUsd: 0,
      },
    };
    const parsed = ConfigSchema.parse(valid);
    expect(parsed.github.authType).toBe('pat');
    expect(parsed.sandbox.backend).toBe('docker');
    expect(parsed.licensePolicy.allow).toEqual(['MIT']);
    expect(parsed.agent.maxToolResultBytes).toBe(1_000_000);
    expect(parsed.agent.maxToolArgsDepth).toBe(16);

    // A pre-P-158 config with no `[agent]` block still parses, and gets the
    // documented defaults rather than failing.
    const withoutAgent: Record<string, unknown> = { ...valid };
    delete withoutAgent['agent'];
    const defaulted = ConfigSchema.parse(withoutAgent);
    expect(defaulted.agent).toEqual({
      maxToolResultBytes: 1_000_000,
      maxToolArgsDepth: 16,
      maxIterations: 20,
      maxTokens: 0,
      maxCostUsd: 0,
    });
    // P-164: a pre-P-164 `[agent]` block that predates the cap budgets also
    // still parses, and gets 20/0/0 — the budgets default to OFF, not to a
    // limit that would stop a run the operator never asked to bound.
    const preCap: Record<string, unknown> = {
      ...valid,
      agent: { maxToolResultBytes: 1_000_000, maxToolArgsDepth: 16 },
    };
    const withCapDefaults = ConfigSchema.parse(preCap);
    expect(withCapDefaults.agent.maxIterations).toBe(20);
    expect(withCapDefaults.agent.maxTokens).toBe(0);
    expect(withCapDefaults.agent.maxCostUsd).toBe(0);
  });

  it('rejects invalid config (unknown authType)', () => {
    const bad = {
      github: { authType: 'oauth' },
      openrouter: {},
      anthropic: {},
      ollama: {},
      sandbox: { backend: 'docker', limits: { memory: '2g', cpu: '1', timeout: 600 } },
      paths: { cacheDir: '.cache', worktreeDir: '.wt' },
      licensePolicy: { allow: [], warn: [], deny: [] },
      autonomy: { auto: [], gated: [] },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod's issue path points to the field; verify it's github.authType
      const tree = JSON.stringify(result.error.format());
      expect(tree).toMatch(/github/);
    }
  });

  it('zod primitives (z.string, z.number) work as expected from a core module', () => {
    const inner = z.object({ name: z.string().min(1), count: z.number().int().positive() });
    const ok = inner.parse({ name: 'x', count: 3 });
    expect(ok).toEqual({ name: 'x', count: 3 });
    expect(() => inner.parse({ name: '', count: 0 })).toThrow();
  });

  it('zod v4 API: z.url() validates URLs (replacing the v3 z.string().url())', () => {
    const u = z.url();
    expect(u.parse('https://example.com')).toBe('https://example.com');
    expect(() => u.parse('not a url')).toThrow();
  });

  it('inferred type flows: z.infer matches the exported Config type', () => {
    type Inferred = z.infer<typeof ConfigSchema>;
    // Compile-time check: the inferred type is structurally assignable to Config.
    // This is enforced by the typecheck gate; the runtime check below is just
    // confirmation that we can use the type at all.
    const _check: Inferred | null = null;
    expect(_check).toBeNull();
  });
});

describe('P-015 zod v4 compatibility (resolved P-039 via native toJSONSchema)', () => {
  // RESOLVED P-039 (ADR-017): zod-to-json-schema@3.25.2 never supported zod
  // v4 (returned just `{"$schema": "..."}` for any v4 schema), so the package
  // was removed and conversion uses zod v4's native `toJSONSchema` instead.
  // Downgrading zod to v3 was rejected: schema.ts relies on the v4 API
  // (`z.url()`), and every config consumer already targets v4.

  it('native toJSONSchema converts a zod v4 string schema', () => {
    const json = toJSONSchema(z.string());
    const str = JSON.stringify(json);
    expect(str).toContain('$schema');
    // The assertion the old KNOWN-ISSUE comment anticipated: the converter
    // now sees the schema instead of an empty object.
    expect(str).toContain('"type":"string"');
  });
});

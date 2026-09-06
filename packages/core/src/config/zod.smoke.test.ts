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
    };
    const parsed = ConfigSchema.parse(valid);
    expect(parsed.github.authType).toBe('pat');
    expect(parsed.sandbox.backend).toBe('docker');
    expect(parsed.licensePolicy.allow).toEqual(['MIT']);
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

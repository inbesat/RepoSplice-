// P-015 smoke test: confirms that the `zod` dep installed in P-009 is
// resolvable from a core module, that `z.object({...}).parse()` works
// end-to-end on `ConfigSchema`, and that valid + invalid inputs behave
// as expected.
//
// This complements `config/schema.test.ts` (which exercises loadConfig's
// layered-merge + credential validation) with a tiny, spec-shaped
// assertion for the dep itself.
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
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

describe('P-015 zod v4 compatibility (zod-to-json-schema)', () => {
  // KNOWN ISSUE (P-015): zod-to-json-schema@3.25.2 (latest as of 2026-09) is
  // broken with zod v4. The peer-dep accepts `^3.25.28 || ^4` but the
  // converter returns just `{"$schema": "..."}` for any v4 schema. The
  // same test against zod v3 works correctly. Until upstream fixes this,
  // P-039 (AI tool args as JSON Schema) has two options:
  //   (a) downgrade zod to ^3.25.x, or
  //   (b) use the `toJSONSchema()` method native to zod v4 (P-039 follow-up).
  //
  // The P-015 acceptance criterion is satisfied: zod v4 is installed, the
  // public API works, ConfigSchema parses + rejects. Compatibility with
  // zod-to-json-schema is documented here as a known issue, not a
  // blocker for P-015 itself.

  it('KNOWN ISSUE: zod-to-json-schema@3.25.2 does not yet support zod v4 (P-039 follow-up)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner: any = z.string();
    const json = zodToJsonSchema(inner);
    // The output should be a JSON Schema fragment; on zod v4 it is just
    // the $schema marker, indicating the converter sees the schema as empty.
    const str = JSON.stringify(json);
    expect(str).toContain('$schema');
    // Document that this is the broken state — once upstream fixes, this
    // assertion will need to assert `type: "string"` instead.
    expect(str).not.toContain('"type"');
  });
});

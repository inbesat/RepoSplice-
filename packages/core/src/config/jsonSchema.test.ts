import { describe, it, expect } from 'vitest';
import { z, toJSONSchema } from 'zod';
import { configJsonSchema } from './jsonSchema.js';

describe('config jsonSchema (P-039)', () => {
  it('json schema from zod', () => {
    // Spec step 4: a small zod object converts with expected properties/required.
    const small = toJSONSchema(z.object({ name: z.string().min(1), count: z.number().int() }));
    expect(small.type).toBe('object');
    expect(Object.keys(small.properties ?? {})).toEqual(['name', 'count']);
    expect(small.required).toEqual(['name', 'count']);

    // The full ConfigSchema (P-009) emits every top-level section.
    // P-158 added `agent` (the tool args/result limits block); P-175 added
    // `ci`, which is OPTIONAL (it is the GitHub Actions fallback's flag), so it
    // appears in `properties` but not in `required`.
    const full = configJsonSchema();
    expect(full.type).toBe('object');
    expect(Object.keys(full.properties ?? {}).sort()).toEqual(
      [
        'agent',
        'anthropic',
        'autonomy',
        'ci',
        'github',
        'licensePolicy',
        'ollama',
        'openrouter',
        'paths',
        'sandbox',
      ].sort()
    );
    expect([...(full.required ?? [])].sort()).toEqual(
      [
        'agent',
        'anthropic',
        'autonomy',
        'github',
        'licensePolicy',
        'ollama',
        'openrouter',
        'paths',
        'sandbox',
      ].sort()
    );

    // Enums and formats survive conversion (needed by P-139 tool args + P-297/298 I/O).
    const props = full.properties as Record<string, { properties: Record<string, unknown> }>;
    expect(props['sandbox']?.properties['backend']).toEqual({
      type: 'string',
      enum: ['docker', 'github-actions'],
    });
    expect(props['github']?.properties['authType']).toEqual({
      type: 'string',
      enum: ['pat', 'app'],
    });
    expect(props['ollama']?.properties['baseUrl']).toEqual({ type: 'string', format: 'uri' });
  });
});

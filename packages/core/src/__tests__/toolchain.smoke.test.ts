import { describe, it, expect } from 'vitest';

describe('P-040 core toolchain smoke', () => {
  it('runs', () => {
    // The vitest runner and @types/node resolve from the root-hoisted
    // toolchain (P-004) — core does not duplicate them (see PROGRESS P-040).
    expect(typeof process.version).toBe('string');
    expect(Buffer.from('stitch').toString('base64')).toBe('c3RpdGNo');
  });

  it('bun:sqlite-safe environment pins the P-030 adapter rule', async () => {
    // Core tests run under vitest's node environment, where 'bun:sqlite'
    // cannot resolve — which is exactly why store/db.ts must dynamic-import
    // it (Bun runtime) behind a node:sqlite test adapter. If this ever
    // resolves, the adapter indirection can be revisited.
    const outcome = await import('bun:sqlite').then(
      () => 'resolvable' as const,
      () => 'unresolvable' as const
    );
    expect(outcome).toBe('unresolvable');
    expect(typeof window).toBe('undefined');
  });
});

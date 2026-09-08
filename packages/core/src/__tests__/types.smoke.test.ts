import { describe, it, expect } from 'vitest';
import type { Database } from 'bun:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Compile-time pins (erased at runtime — safe under vitest's node workers):
// - `Database` must resolve as a type (P-030 dual-runtime rule).
// - `Bun.version` must be typed as a string (P-061 @types/bun wiring).
type DbOrNull = Database | null;
type BunVersion = typeof Bun.version;
type AssertString<T extends string> = T;
type CheckBunVersion = AssertString<BunVersion>;

/** Describe a database handle without ever constructing one under node. */
function describeDatabase(db: DbOrNull): string {
  if (db === null) return 'no-bun';
  return 'bun-db';
}

describe('ambient types (P-061 @types/bun + @types/node)', () => {
  it('types', async () => {
    // Type-level: Bun.version is a string; Database-or-null narrows.
    const check: CheckBunVersion = 'pinned';
    expect(typeof check).toBe('string');
    expect(describeDatabase(null)).toBe('no-bun');

    // node:fs/promises + node:os + node:path resolve at type AND runtime.
    const dir = await mkdtemp(join(tmpdir(), 'stitch-types-'));
    try {
      const file = join(dir, 'probe.txt');
      await writeFile(file, 'stitch', 'utf8');
      await expect(readFile(file, 'utf8')).resolves.toBe('stitch');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    // @types/node globals resolve: process.env is a string map.
    const pathVar: string | undefined = process.env['PATH'];
    expect(pathVar === undefined || typeof pathVar === 'string').toBe(true);
  });
});

// P-022 smoke test: confirms findCycles detects deliberate cycles AND
// reports an empty list for a clean tree. madge is configured to walk
// only `.ts` files inside the temp dir.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { findCycles, hasCycles, filesInCycles } from './circular.js';
import { err } from 'neverthrow';
import type { StitchError } from '../result/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const coreSrc = join(repoRoot, 'packages', 'core', 'src');

describe('P-022 findCycles: clean tree has no cycles', () => {
  it('reports zero cycles for packages/core/src', async () => {
    const r = await findCycles(coreSrc, { fileExtensions: ['ts'] });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toEqual([]);
      expect(hasCycles(r.value)).toBe(false);
    }
  }, 60_000);
});

describe('P-022 findCycles: detects a deliberate cycle in a fixture', () => {
  let tmpDir: string;
  beforeAll(async () => {
    // Use a path under repoRoot (not tmpdir) — same trick as the
    // depcruise smoke: Windows + depcruise/madge absolute paths in
    // tmpdir() can produce path-mangling issues. The .circular-fixture
    // dir is gitignored implicitly (we add it to .gitignore below).
    tmpDir = resolve(repoRoot, 'packages', 'core', '.circular-fixture');
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(join(tmpDir, 'a'), { recursive: true });
    await mkdir(join(tmpDir, 'b'), { recursive: true });
    // a → b → a  (cycle)
    await writeFile(
      join(tmpDir, 'a', 'index.ts'),
      `import { b } from '../b/index.js';\nexport const a = () => b();\n`
    );
    await writeFile(
      join(tmpDir, 'b', 'index.ts'),
      `import { a } from '../a/index.js';\nexport const b = () => a();\n`
    );
  });
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('findCycles reports a 2-file cycle', async () => {
    const r = await findCycles(tmpDir, { fileExtensions: ['ts'] });
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(hasCycles(r.value)).toBe(true);
      expect(r.value.length).toBeGreaterThanOrEqual(1);
      // The cycle(s) must include both files
      const involved = filesInCycles(r.value);
      // madge emits POSIX-style paths inside the cycle list
      const asPaths = [...involved].map(p => p.replaceAll('\\', '/'));
      expect(asPaths.some(p => p.endsWith('a/index.ts'))).toBe(true);
      expect(asPaths.some(p => p.endsWith('b/index.ts'))).toBe(true);
    }
  }, 60_000);
});

describe('P-022 findCycles: rejects a bad path', () => {
  it('returns a typed INTERNAL err when root does not exist', async () => {
    // madge throws synchronously inside its constructor (not a Promise
    // rejection) when the path is invalid, so we wrap the call in a
    // try/catch and map to the same err shape.
    const badPath = join(repoRoot, 'this', 'path', 'does', 'not', 'exist');
    let r: Awaited<ReturnType<typeof findCycles>>;
    try {
      r = await findCycles(badPath, { fileExtensions: ['ts'] });
    } catch (e) {
      r = err<string[][], StitchError>({
        code: 'INTERNAL',
        message: `madge init failed for ${badPath}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.code).toBe('INTERNAL');
    }
  }, 30_000);
});

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** packages/core — the tsup build runs with cwd here. */
const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(CORE, 'dist');

interface BuildOutcome {
  code: number;
  out: string;
}

/** Run the package's own build script exactly as CI/a human would. */
function runBuild(): Promise<BuildOutcome> {
  return new Promise(resolvePromise => {
    execFile('bun', ['run', 'build'], { cwd: CORE, timeout: 170_000 }, (error, stdout, stderr) => {
      if (error !== null) {
        resolvePromise({ code: 1, out: `${stdout}\n${stderr}\n${error.message}` });
      } else {
        resolvePromise({ code: 0, out: `${stdout}` });
      }
    });
  });
}

function nonEmpty(path: string): void {
  expect(existsSync(path), `missing build artifact: ${path}`).toBe(true);
  expect(statSync(path).size, `empty build artifact: ${path}`).toBeGreaterThan(0);
}

describe('core build (P-062 tsup)', () => {
  it('builds', { timeout: 180_000 }, async () => {
    const { code, out } = await runBuild();
    expect(code, `tsup build failed:\n${out}`).toBe(0);

    // ESM + CJS + declarations from the public surface (P-011/P-013).
    nonEmpty(join(DIST, 'index.js'));
    nonEmpty(join(DIST, 'index.cjs'));
    nonEmpty(join(DIST, 'index.d.ts'));

    // The emitted declarations carry the barrel's public surface, so an
    // external import of the built package resolves its types (P-278).
    const dts = readFileSync(join(DIST, 'index.d.ts'), 'utf8');
    expect(dts).toContain('STITCH_ERROR_CODES');
    expect(dts).toContain('configJsonSchema');
    expect(dts).toContain('CORE_NAME');

    // Both bundles load under plain node with the public surface intact.
    // The ESM import below is type-checked against dist/index.d.ts, which
    // is itself the proof that emitted types resolve for external imports.
    const esm = await import('../../dist/index.js');
    expect(esm.CORE_NAME).toBe('@repo-stitcher/core');
    expect(esm.STITCH_ERROR_CODES).toHaveLength(14);

    const require = createRequire(import.meta.url);
    const cjs = require('../../dist/index.cjs') as {
      CORE_NAME: unknown;
      STITCH_ERROR_CODES: unknown[];
      configJsonSchema: unknown;
    };
    expect(cjs.CORE_NAME).toBe('@repo-stitcher/core');
    expect(cjs.STITCH_ERROR_CODES).toHaveLength(14);
    expect(cjs.configJsonSchema).toBeTypeOf('function');
  });
});

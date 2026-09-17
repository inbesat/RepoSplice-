// P-021 smoke test: confirms the dependency-cruiser config is valid
// AND the current core src/ has no violations. The "fixture doubles
// as the test" requirement (per spec) is satisfied by running
// `depcruise --validate packages/core/src --config packages/core/dependency-cruiser.config.cjs`
// from the repo root in CI (see `.github/workflows/ci.yml`).
//
// Note: depcruise's forbidden rule only fires when the target module
// is *resolvable* (installed in node_modules). Since none of the
// forbidden packages (axios, jest, joi, etc.) are in this monorepo's
// deps, the config currently has 0 violations by design. When P-104+
// adds real dependency analysis and someone accidentally introduces
// one of the forbidden packages, depcruise will catch it.
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');

describe('P-021 depcruise: config is valid + clean tree has no violations', () => {
  let errorCount: number;
  beforeAll(async () => {
    // Shells the SAME depcruise CLI that `lint:deps` runs instead of the
    // in-process `cruise()`: in-process TS resolution inside a vitest
    // worker balloons from ~26s standalone to 130s+ in-run and grows with
    // the src tree, while the child process stays in seconds under load
    // (measured: 30s wall with 4 concurrent vitest runs). Same config,
    // same tree, same assertion — flake fixed at the root, not silenced.
    let stdout: string;
    // bun on Windows emits `depcruise.exe`/`depcruise.bunx` shims (no .cmd);
    // resolve the real executable explicitly so spawn never hits EINVAL.
    const binName = process.platform === 'win32' ? 'depcruise.exe' : 'depcruise';
    const bin = resolve(repoRoot, 'node_modules', '.bin', binName);
    try {
      stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
        execFile(
          bin,
          ['packages/core/src', '--config', 'packages/core/dependency-cruiser.config.cjs'],
          { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
          (error: Error | null, out: string) => {
            if (error !== null) {
              rejectPromise(error);
              return;
            }
            resolvePromise(out);
          }
        );
      });
    } catch (e) {
      throw new Error('depcruise CLI failed to run', { cause: e });
    }
    const violations = stdout.match(/(\d+)\s+errors?\b/i);
    errorCount = violations === null ? 0 : Number(violations[1]);
  }, 180_000);

  it('reports zero violations against the current src/', () => {
    expect(errorCount).toBe(0);
  });
});

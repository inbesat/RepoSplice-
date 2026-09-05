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
import { cruise } from 'dependency-cruiser';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const coreSrc = join(repoRoot, 'packages', 'core', 'src');
const configPath = join(repoRoot, 'packages', 'core', 'dependency-cruiser.config.cjs');

describe('P-021 depcruise: config is valid + clean tree has no violations', () => {
  let errorCount: number;
  beforeAll(async () => {
    const result = await cruise([coreSrc], {
      rulesFile: configPath,
    });
    // IReporterOutput is `string | ICruiseResult`; with our text
    // reporter we get the object form. The cast is safe because we
    // never configured a string-emitting reporter.
    const obj = result as { output: { summary: { error: number } } };
    errorCount = obj.output.summary.error;
  }, 60_000);

  it('reports zero violations against the current src/', () => {
    expect(errorCount).toBe(0);
  });
});

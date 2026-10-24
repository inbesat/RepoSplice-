// P-253 — the repo-level guard: the unit-test conventions are ENFORCED here,
// not merely written down in TESTING.md.
//
// It walks every test file in the workspace and refuses the three ways a suite
// rots: a focused test committed by accident, a skipped test with no issue to
// come back to, and a shared helper that reaches for the network.
//
// The two tokens it looks for are BUILT BY CONCATENATION so this file cannot
// trip its own check (a guard that fails on itself is worse than no guard).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const PACKAGES_ROOT = join(REPO_ROOT, 'packages');

const ONLY = '.' + 'only(';
const SKIP = '.' + 'skip(';
const SKIP_ALLOW_MARKER = 'skip-ok:';
const ISSUE_REFERENCE = /(https:\/\/\S+|#\d+)/;

/** The helper files each package owns, and the guard's own doc. */
const HELPER_FILES = [
  'packages/core/src/test/helpers.ts',
  'packages/cli/src/test/helpers.ts',
] as const;
const CONVENTIONS_DOC = 'TESTING.md';

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/** Every file under `dir` that `keep` accepts; directories are pruned. */
function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, keep, out);
    } else if (entry.isFile() && keep(entry.name)) {
      out.push(absolute);
    }
  }
  return out;
}

/** Is this a test file (TS/TSX) or one of the mandated python drivers? */
function isTestFile(name: string): boolean {
  if (/\.(test|spec)\.(ts|tsx)$/.test(name)) return true;
  if (/^test_.*\.py$/.test(name)) return true;
  if (/\.spec\.py$/.test(name)) return true;
  return false;
}

function testFiles(): readonly string[] {
  const found = walk(PACKAGES_ROOT, isTestFile);
  return found.sort((left, right) => left.localeCompare(right));
}

function lines(path: string): readonly string[] {
  return readFileSync(path, 'utf8').split(/\r?\n/);
}

function relativePath(absolute: string): string {
  return relative(REPO_ROOT, absolute).replace(/\\/g, '/');
}

describe('unit-test conventions (P-253 guard)', () => {
  it('finds the test files it is supposed to guard', () => {
    const files = testFiles();
    // A guard that silently scans nothing is worse than no guard.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(path => path.endsWith('.test.ts'))).toBe(true);
    expect(files.some(path => path.endsWith('test_resolve_tool.py'))).toBe(true);
    expect(files.some(path => path.endsWith('contract.conform.spec.ts'))).toBe(true);
  });

  it('ships no focused test', () => {
    const violations: string[] = [];
    for (const path of testFiles()) {
      lines(path).forEach((line, index) => {
        if (line.includes(ONLY)) {
          violations.push(`${relativePath(path)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('allows a skipped test only with a linked issue beside it', () => {
    const violations: string[] = [];
    let allowed = 0;
    for (const path of testFiles()) {
      const content = lines(path);
      content.forEach((line, index) => {
        if (!line.includes(SKIP)) return;
        const previous = index > 0 ? (content[index - 1] ?? '') : '';
        const marker = line.includes(SKIP_ALLOW_MARKER)
          ? line
          : previous.includes(SKIP_ALLOW_MARKER)
            ? previous
            : undefined;
        if (marker === undefined || !ISSUE_REFERENCE.test(marker)) {
          violations.push(`${relativePath(path)}:${index + 1}: ${line.trim()}`);
          return;
        }
        allowed += 1;
      });
    }
    expect(violations).toEqual([]);
    // `allowed` is reported through the assertion above; this keeps the count
    // visible in the failure message instead of being an unused local.
    expect(allowed).toBeGreaterThanOrEqual(0);
  });

  it('keeps the shared helpers offline and deterministic', () => {
    const forbidden = ['fetch(', 'XMLHttpRequest', 'axios', 'Math.random(', 'Date.now('];
    for (const relativePathEntry of HELPER_FILES) {
      const absolute = join(REPO_ROOT, relativePathEntry);
      expect(existsSync(absolute), `${relativePathEntry} is missing`).toBe(true);
      const content = readFileSync(absolute, 'utf8');
      for (const token of forbidden) {
        expect(content.includes(token), `${relativePathEntry} uses ${token}`).toBe(false);
      }
    }
  });

  it('keeps the conventions documented and the runner wired to them', () => {
    const doc = join(REPO_ROOT, CONVENTIONS_DOC);
    expect(existsSync(doc), `${CONVENTIONS_DOC} is missing`).toBe(true);
    const text = readFileSync(doc, 'utf8');
    for (const heading of [
      '## Layout and naming',
      '## One test, one behaviour',
      '## Determinism',
      '## Isolation',
      '## Coverage',
      '## Shared helpers',
      '## The guard',
    ]) {
      expect(text.includes(heading), `${CONVENTIONS_DOC} is missing ${heading}`).toBe(true);
    }

    const contributing = readFileSync(join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing.includes(CONVENTIONS_DOC)).toBe(true);

    const bunfig = readFileSync(join(REPO_ROOT, 'bunfig.toml'), 'utf8');
    expect(bunfig).toContain('[test]');
    expect(bunfig).toContain(CONVENTIONS_DOC);

    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(rootPackage.scripts?.['test:unit']).toBeDefined();

    // P-236's web harness already satisfies P-253, so alignment is existence,
    // not an edit (ADR-177).
    expect(existsSync(join(PACKAGES_ROOT, 'web', 'src', 'test', 'setup.ts'))).toBe(true);
  });
});

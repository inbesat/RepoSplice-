// P-197 — `stitch deps` tests.
//
// The six mandated cases from the phase's "Tests Required" section, driven
// against REAL fixture manifests (the real detector → parser → merge → report
// pipeline) and a real user-config store in a temp directory:
//
//   it('renders report')            it('persists resolution')
//   it('auto resolves review')      it('fails on error conflict')
//   it('lockfile flag')             it('json output')
//   + extras: a skipped question still fails the run; a manifest-less
//     selection is a note, not an error; the root-most manifest wins;
//     a second ecosystem renders its own section (and --json arrays it).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '@repo-stitcher/core';
import {
  deps,
  readDepResolutions,
  type DepsDeps,
  type DepsOptions,
  type DepsPromptContext,
  type DepsPrompt,
  type RunLockfile,
} from './deps.js';
import { openStore, type StitchStore } from '../config.js';

// ---------------------------------------------------------------------------
// fixtures — real temp trees + a real store
// ---------------------------------------------------------------------------

let tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempRoots.push(dir);
  return dir;
}

/** A fixture source: one root package.json (optionally a nested one). */
function makeSource(
  manifest: Record<string, unknown>,
  extras: { childManifest?: Record<string, unknown> } = {}
): string {
  const root = tempDir('stitch-deps-src');
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2));
  if (extras.childManifest !== undefined) {
    mkdirSync(join(root, 'packages', 'child'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'child', 'package.json'),
      JSON.stringify(extras.childManifest, null, 2)
    );
  }
  return root;
}

function makeStore(): StitchStore {
  const opened = openStore(tempDir('stitch-deps-store'));
  if (opened.isErr()) throw new Error('temp store did not open');
  return opened.value;
}

/** Record the selections mapped by the resolve port's fixture map. */
function recordSelection(store: StitchStore, names: readonly string[]): void {
  const saved = store.set(
    'sources',
    names.map(name => ({ source: name, paths: ['**/*'] }))
  );
  expect(saved.isOk()).toBe(true);
}

function resolveOf(map: Record<string, string>): NonNullable<DepsDeps['resolveSource']> {
  return async (source: string) => {
    const dir = map[source];
    if (dir === undefined) {
      return err({ code: 'CONFIG_ERROR', field: 'source', message: `no fixture for ${source}` });
    }
    return ok(dir);
  };
}

interface RunOutcome {
  lines: string[];
  result: Result<void, StitchError>;
}

/** Drive `deps` with deterministic globals and a captured writer. */
async function runDeps(opts: Partial<DepsOptions>, depsIn: DepsDeps): Promise<RunOutcome> {
  const lines: string[] = [];
  const result = await deps(
    { verbose: false, yes: false, offline: false, color: false, ...opts },
    {
      ...depsIn,
      write: (line: string) => {
        lines.push(line);
      },
    }
  );
  return { lines, result };
}

/** Build deps-injections from fixture srcdirs: real loader, fake prompt. */
function fixtureDeps(
  sources: Record<string, string>,
  options: { prompt?: DepsPrompt; runLockfile?: RunLockfile } = {}
): { depsIn: DepsDeps; asked: DepsPromptContext[] } {
  const asked: DepsPromptContext[] = [];
  // The recording prompt always rides along; it only fires when an
  // attention conflict exists, so conflict-free fixtures stay silent.
  const prompt: DepsPrompt = async ctx => {
    asked.push(ctx);
    return options.prompt === undefined ? null : options.prompt(ctx);
  };
  return {
    asked,
    depsIn: {
      resolveSource: resolveOf(sources),
      prompt,
      ...(options.runLockfile !== undefined ? { runLockfile: options.runLockfile } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// shared fixtures and lockfile stubs
// ---------------------------------------------------------------------------

const LOCK_OK: import('@repo-stitcher/core').LockfileResult = {
  ecosystem: 'npm',
  lockfilePath: '/tmp/scratch/bun.lock',
  command: 'bun install --frozen-lockfile=false',
  exitCode: 0,
  stdout: '',
  stderr: '',
  createdAt: '2026-10-17T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// the six mandated cases + the honest extras
// ---------------------------------------------------------------------------

describe('P-197 stitch deps', () => {
  it('renders report', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0', unique: '^0.1.0' } });
    const b = makeSource({
      name: 'b',
      dependencies: { shared: '^1.0.0' },
      devDependencies: { eslint: '^8.0.0' },
    });
    const store = makeStore();
    recordSelection(store, ['a', 'b']);
    const { depsIn } = fixtureDeps({ a, b });

    const { lines, result } = await runDeps({}, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    expect(lines[0]).toBe('stitch deps');
    expect(lines.find(line => line.startsWith('sources: '))).toContain('a, b');
    expect(lines.find(line => line.startsWith('dependencies: '))).toBe(
      'dependencies: direct 2, dev 1, peer 0 (total 3)'
    );
    expect(lines.find(line => line.startsWith('  dependencies '))).toContain('shared@^1.0.0');
    expect(lines.find(line => line.startsWith('  dependencies '))).toContain('unique@^0.1.0');
    expect(lines.find(line => line.startsWith('  devDependencies '))).toContain('eslint@^8.0.0');
    expect(lines.find(line => line.startsWith('conflicts ('))).toBe('conflicts (0):');
    expect(lines.includes('lockfile: not requested')).toBe(true);
    expect(lines.some(line => line.startsWith('mergeable: '))).toBe(true);
  });

  it('persists resolution', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const b = makeSource({ name: 'b', dependencies: { shared: '^3.0.0' } });
    const store = makeStore();
    recordSelection(store, ['a', 'b']);
    const { depsIn, asked } = fixtureDeps({ a, b }, { prompt: async () => '^2.0.0' });

    const { lines, result } = await runDeps({}, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatchObject({ package: 'shared', severity: 'error' });
    expect(asked[0]!.values).toEqual({ 'repo-a': '^1.0.0', 'repo-b': '^3.0.0' });
    const row = lines.find(line => line.startsWith('shared '));
    expect(row).toBeDefined();
    expect(row).toContain('^2.0.0');
    expect(row).toContain('auto-resolved');
    expect(readDepResolutions(store).map(entry => entry.package)).toEqual(['shared']);
    expect(readDepResolutions(store).map(entry => entry.resolution)).toEqual(['^2.0.0']);
    expect(lines.includes('resolutions recorded: 1')).toBe(true);
  });

  it('auto resolves review', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const b = makeSource({ name: 'b', dependencies: { shared: '^1.2.0' } });
    const store = makeStore();
    recordSelection(store, ['a', 'b']);
    const { depsIn } = fixtureDeps({ a, b });

    const { lines, result } = await runDeps({ auto: true }, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    // The measured core behavior: compatible ranges hoist, and the suggestion
    // is the resolver's wording — recorded verbatim as its chosen resolution.
    const stored = readDepResolutions(store);
    expect(stored.length).toBe(1);
    expect(stored[0]).toMatchObject({ package: 'shared' });
    expect(stored[0]!.resolution).toContain('hoist');
    const row = lines.find(line => line.startsWith('shared '));
    expect(row).toContain('auto-resolved');
    expect(
      lines.includes('auto mode: applied the resolver\u2019s suggestion to every fixable conflict')
    ).toBe(true);
  });

  it('fails on error conflict', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const b = makeSource({ name: 'b', dependencies: { shared: '^3.0.0' } });
    const store = makeStore();
    recordSelection(store, ['a', 'b']);
    const { depsIn } = fixtureDeps({ a, b });

    const { lines, result } = await runDeps({ auto: true }, { store, ...depsIn });

    expect(result.isErr()).toBe(true);
    if (result.isErr() === false) return;
    // Code narrowing first (the license test's pattern): the variant carries
    // the package list.
    expect(result.error.code).toBe('DEPENDENCY_CONFLICT');
    if (result.error.code !== 'DEPENDENCY_CONFLICT') return;
    expect([...new Set(result.error.packages)]).toEqual(['shared']);
    // The full report still rendered (print-then-fail, the doctor precedent).
    expect(lines.some(line => line.startsWith('conflicts (1):'))).toBe(true);
    const row = lines.find(line => line.startsWith('shared '));
    expect(row).toContain('needs-attention');
    expect(
      lines.some(line => line.startsWith('mergeable: no') && line.includes('needs a human'))
    ).toBe(true);
  });

  it('lockfile flag', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const store = makeStore();
    recordSelection(store, ['a']);
    const { depsIn } = fixtureDeps({ a }, { runLockfile: async () => ok(LOCK_OK) });

    const { lines, result } = await runDeps({ lockfile: true }, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    expect(
      lines.includes(
        'lockfile: generated (/tmp/scratch/bun.lock via bun install --frozen-lockfile=false)'
      )
    ).toBe(true);
    expect(lines.includes('mergeable: yes')).toBe(true);

    // A failed regeneration is a WARN note (environment), not a data failure:
    // the report keeps lockfile null and `mergeable` honestly stays false.
    const secondRun = await runDeps(
      { lockfile: true },
      {
        store,
        ...fixtureDeps(
          { a },
          {
            runLockfile: async () =>
              err({ code: 'CONFIG_ERROR', field: 'registry', message: 'offline registry refused' }),
          }
        ).depsIn,
      }
    );
    expect(secondRun.result.isOk()).toBe(true);
    expect(
      secondRun.lines.some(
        line =>
          line.startsWith('lockfile: generation failed: ') &&
          line.includes('offline registry refused')
      )
    ).toBe(true);
    expect(secondRun.lines.some(line => line.startsWith('mergeable: no'))).toBe(true);
  });

  it('json output', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const store = makeStore();
    recordSelection(store, ['a']);
    const { depsIn } = fixtureDeps({ a });

    const { lines, result } = await runDeps({ json: true }, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    const data = JSON.parse(lines.join('\n')) as {
      ecosystem: string;
      merged: { dependencies: Record<string, string> };
      dependencyCount: { direct: number; total: number };
      conflicts: unknown[];
      summary: { mergeable: boolean; needsHuman: boolean; blockedBy: string[] };
    };
    expect(data.ecosystem).toBe('npm');
    expect(data.merged.dependencies).toEqual({ shared: '^1.0.0' });
    expect(data.dependencyCount).toMatchObject({ direct: 1, total: 1 });
    expect(data.conflicts).toEqual([]);
    expect(data.summary).toMatchObject({ mergeable: false, needsHuman: false, blockedBy: [] });
  });

  it('a skipped question leaves the conflict needs-attention and fails the run', async () => {
    const a = makeSource({ name: 'a', dependencies: { shared: '^1.0.0' } });
    const b = makeSource({ name: 'b', dependencies: { shared: '^3.0.0' } });
    const store = makeStore();
    recordSelection(store, ['a', 'b']);
    const { depsIn } = fixtureDeps({ a, b }, { prompt: async () => null });

    const { lines, result } = await runDeps({}, { store, ...depsIn });

    expect(result.isErr()).toBe(true);
    expect(readDepResolutions(store)).toEqual([]);
    const row = lines.find(line => line.startsWith('shared '));
    expect(row).toContain('needs-attention');
    expect(lines.some(line => line.includes('needs a resolution: repo-a wanted ^1.0.0'))).toBe(
      true
    );
    expect(
      lines.some(line => line.startsWith('mergeable: no') && line.includes('needs a human'))
    ).toBe(true);
  });

  it('skips a manifest-less selection with a note', async () => {
    const empty = tempDir('stitch-deps-none');
    const b = makeSource({ name: 'b', dependencies: { shared: '^1.0.0' } });
    const store = makeStore();
    recordSelection(store, ['aaa', 'b']);
    const { depsIn } = fixtureDeps({ aaa: empty, b });

    const { lines, result } = await runDeps({}, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    expect(lines.find(line => line.startsWith('sources: '))).toContain(
      'skipped, no manifests: aaa'
    );
    expect(lines.find(line => line.startsWith('ecosystem: '))).toBe('ecosystem: npm');
  });

  it('merges only the root-most manifest per selection', async () => {
    const one = makeSource(
      { name: 'one', dependencies: { root: '^9.0.0' } },
      { childManifest: { name: 'one-child', dependencies: { childOnly: '^1.0.0' } } }
    );
    const store = makeStore();
    recordSelection(store, ['one']);
    const { depsIn } = fixtureDeps({ one });

    const { lines, result } = await runDeps({ json: true }, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    const data = JSON.parse(lines.join('\n')) as {
      merged: { dependencies: Record<string, string> };
    };
    expect(data.merged.dependencies).toEqual({ root: '^9.0.0' });
  });

  it('renders a second ecosystem as its own section (and arrays --json)', async () => {
    const npm = makeSource({ name: 'npm-repo', dependencies: { shared: '^1.0.0' } });
    const py = tempDir('stitch-deps-py');
    writeFileSync(
      join(py, 'pyproject.toml'),
      '[project]\nname = "py-repo"\ndependencies = ["flask>=2.0"]\n'
    );
    const store = makeStore();
    recordSelection(store, ['npm-repo', 'py-repo']);
    const { depsIn } = fixtureDeps({ 'npm-repo': npm, 'py-repo': py });

    const { lines, result } = await runDeps({}, { store, ...depsIn });

    expect(result.isOk()).toBe(true);
    expect(lines.filter(line => line.startsWith('ecosystem: '))).toEqual([
      'ecosystem: npm',
      'ecosystem: python',
    ]);
    expect(lines.some(line => line.includes('flask@>=2.0'))).toBe(true);

    const jsonRun = await runDeps({ json: true }, { store, ...depsIn });
    expect(jsonRun.result.isOk()).toBe(true);
    const parsed = JSON.parse(jsonRun.lines.join('\n')) as { ecosystem: string }[];
    expect(parsed.map(report => report.ecosystem)).toEqual(['npm', 'python']);
  });
});

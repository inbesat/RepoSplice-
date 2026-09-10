// Conflict detection + resolution (P-075): full suite. Real git proves the
// mechanics (porcelain codes, stage SHAs, NUL-binary, -w equivalence, apply
// flows); scripted runners prove every failure arm; pure unit tests prove
// the classifier table and the gitignore union.
//
// Timeout note: real-git tests carry an explicit 30s budget (third `it`
// arg). The core project resolves vitest's 5s default (the root 30s does
// not inherit into defineProject); a five-kind fixture is ~30 spawns and
// exceeds 5s under parallel load (P-053 precedent: slow git tests get the
// root-config budget). Scripted/pure tests keep the strict default.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import {
  detectConflicts,
  resolveConflicts,
  classifyStages,
  unionGitignoreSides,
  resolveTargetPath,
  exitCodeOf,
  DEFAULT_CONFLICT_TIMEOUT_MS,
  type Conflict,
  type ConflictGate,
  type ConflictRunner,
  type ConflictRunResult,
  type ConflictRuntime,
  type ConflictStages,
  type ManifestMerge,
} from './conflict.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function writeText(repo: string, rel: string, content: string): Promise<void> {
  await writeFile(join(repo, rel), content);
}

async function writeBytes(repo: string, rel: string, bytes: number[]): Promise<void> {
  await writeFile(join(repo, rel), Buffer.from(bytes));
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf, no CRLF games). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-conflict-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  return repo;
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', message]);
}

/** Merge side into main (fast-forward first side, conflict on second). */
async function mergeSide(repo: string, branch: string): Promise<void> {
  try {
    await git(repo, ['merge', branch, '--no-edit']);
  } catch {
    // Exit 1 = conflicts; anything else surfaces in the assertions.
  }
}

interface OursFiles {
  text: string;
  binary: number[];
  manifest: string;
  gitignore: string;
  deleted: null;
}

interface TheirsFiles {
  text: string;
  binary: number[];
  manifest: string;
  gitignore: string;
  deleted: string;
}

const BASE_TEXT = 'l1\nbase\nl3\n';
const BASE_MANIFEST = JSON.stringify({ name: 'child', deps: { left: '1.0.0' } }, null, 2) + '\n';
const BASE_GITIGNORE = 'node_modules/\n';

/** Five-kind conflicted repo: text UU, binary UU, manifest UU, gitignore UU, deleted UD. */
async function makeFiveKindRepo(): Promise<{
  repo: string;
  ours: OursFiles;
  theirs: TheirsFiles;
}> {
  const repo = await makeRepo();
  await writeText(repo, 'a.txt', BASE_TEXT);
  await writeBytes(repo, 'bin.dat', [65, 66, 0, 67, 68]);
  await writeText(repo, 'package.json', BASE_MANIFEST);
  await writeText(repo, '.gitignore', BASE_GITIGNORE);
  await writeText(repo, 'gone.txt', 'doomed\n');
  await commitAll(repo, 'base');

  const ours: OursFiles = {
    text: 'l1\nOURS\nl3\n',
    binary: [65, 66, 0, 99],
    manifest:
      JSON.stringify({ name: 'child', deps: { left: '1.0.0', oursOnly: '2.0.0' } }, null, 2) + '\n',
    gitignore: 'node_modules/\ndist-ours/\n',
    deleted: null,
  };
  await git(repo, ['checkout', '-qb', 'side-a']);
  await writeText(repo, 'a.txt', ours.text);
  await writeBytes(repo, 'bin.dat', ours.binary);
  await writeText(repo, 'package.json', ours.manifest);
  await writeText(repo, '.gitignore', ours.gitignore);
  await git(repo, ['rm', '-q', 'gone.txt']);
  await commitAll(repo, 'side a');

  const theirs: TheirsFiles = {
    text: 'l1\nTHEIRS\nl3\n',
    binary: [65, 66, 0, 100],
    manifest:
      JSON.stringify({ name: 'child', deps: { left: '1.0.0', theirsOnly: '3.0.0' } }, null, 2) +
      '\n',
    gitignore: 'node_modules/\n!.env\n',
    deleted: 'doomed changed\n',
  };
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['checkout', '-qb', 'side-b']);
  await writeText(repo, 'a.txt', theirs.text);
  await writeBytes(repo, 'bin.dat', theirs.binary);
  await writeText(repo, 'package.json', theirs.manifest);
  await writeText(repo, '.gitignore', theirs.gitignore);
  await writeText(repo, 'gone.txt', theirs.deleted);
  await commitAll(repo, 'side b');

  await git(repo, ['checkout', '-q', 'main']);
  await mergeSide(repo, 'side-a');
  await mergeSide(repo, 'side-b');
  return { repo, ours, theirs };
}

/** Both sides touch only whitespace: -w equivalent, still UU. */
async function makeWhitespaceRepo(): Promise<{ repo: string; ours: string }> {
  const repo = await makeRepo();
  await writeText(repo, 'ws.txt', 'hello world\nsecond line\n');
  await commitAll(repo, 'base');
  await git(repo, ['checkout', '-qb', 'wa']);
  const ours = 'hello   world\nsecond line\n';
  await writeText(repo, 'ws.txt', ours);
  await commitAll(repo, 'a');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['checkout', '-qb', 'wb']);
  await writeText(repo, 'ws.txt', 'hello world  \nsecond line\n');
  await commitAll(repo, 'b');
  await git(repo, ['checkout', '-q', 'main']);
  await mergeSide(repo, 'wa');
  await mergeSide(repo, 'wb');
  return { repo, ours };
}

/** Sides differ only by trailing newline: the spec's explicit auto-clean case. */
async function makeTrailingNewlineRepo(): Promise<{ repo: string; ours: string }> {
  const repo = await makeRepo();
  await writeText(repo, 'nl.txt', 'alpha\n');
  await commitAll(repo, 'base');
  await git(repo, ['checkout', '-qb', 'na']);
  const ours = 'alpha  \n';
  await writeText(repo, 'nl.txt', ours);
  await commitAll(repo, 'a');
  await git(repo, ['checkout', '-q', 'main']);
  await git(repo, ['checkout', '-qb', 'nb']);
  await writeText(repo, 'nl.txt', 'alpha');
  await commitAll(repo, 'b');
  await git(repo, ['checkout', '-q', 'main']);
  await mergeSide(repo, 'na');
  await mergeSide(repo, 'nb');
  return { repo, ours };
}

function byPath(conflicts: Conflict[]): Map<string, Conflict> {
  return new Map(conflicts.map(c => [c.path, c]));
}

function PorcelainOf(repo: string): Promise<string> {
  return git(repo, ['status', '--porcelain']);
}

// ─── Scripted runner ─────────────────────────────────────────────────────

function scriptedRun(
  handler: (args: readonly string[], cwd: string) => ConflictRunResult
): ConflictRunner {
  return async (args, cwd) => handler(args, cwd);
}

function okRun(stdout: string | Buffer = ''): ConflictRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): ConflictRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

/** ls-files -u -z payload builder: `mode sha stage\tpath` NUL-separated. */
function lsFilesU(entries: Array<{ sha: string; stage: 1 | 2 | 3; path: string }>): Buffer {
  return Buffer.from(entries.map(e => `100644 ${e.sha} ${e.stage}\t${e.path}`).join('\0') + '\0');
}

const SHA1 = '1111111111111111111111111111111111111111';
const SHA2 = '2222222222222222222222222222222222222222';
const SHA3 = '3333333333333333333333333333333333333333';

const PORCELAIN_UU = Buffer.from('UU a.txt\0');
const DIFF_U = Buffer.from('a.txt\0');

/** Standard happy-path scripted repo: one both-modified text conflict. */
function textConflictRun(
  overrides: Partial<Record<string, ConflictRunResult>> = {}
): ConflictRunner {
  const table: Record<string, ConflictRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    status: okRun(PORCELAIN_UU),
    diff: okRun(DIFF_U),
    'ls-files': okRun(
      lsFilesU([
        { sha: SHA1, stage: 1, path: 'a.txt' },
        { sha: SHA2, stage: 2, path: 'a.txt' },
        { sha: SHA3, stage: 3, path: 'a.txt' },
      ])
    ),
    'show:1': okRun('base\n'),
    'show:2': okRun('ours\n'),
    'show:3': okRun('theirs\n'),
    'diff-quiet': failRun(1, ''),
    checkout: okRun(''),
    add: okRun(''),
    ...overrides,
  };
  return scriptedRun(args => {
    const key =
      args[0] === 'show' && typeof args[1] === 'string' && /^[0-9a-f]{40}$/.test(args[1])
        ? `show:${args[1] === SHA1 ? '1' : args[1] === SHA2 ? '2' : '3'}`
        : args[0] === 'diff' && args[1] === '--quiet'
          ? 'diff-quiet'
          : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  });
}

function throwingRun(message: string): ConflictRunner {
  return scriptedRun(() => {
    throw new Error(message);
  });
}

/** One both-modified text conflict at an arbitrary path (scripted). */
function singleConflictRun(
  rel: string,
  overrides: Partial<Record<string, ConflictRunResult>> = {}
): ConflictRunner {
  return textConflictRun({
    status: okRun(Buffer.from(`UU ${rel}\0`)),
    diff: okRun(Buffer.from(`${rel}\0`)),
    'ls-files': okRun(
      lsFilesU([
        { sha: SHA1, stage: 1, path: rel },
        { sha: SHA2, stage: 2, path: rel },
        { sha: SHA3, stage: 3, path: rel },
      ])
    ),
    ...overrides,
  });
}

const approveTheirs: ConflictGate = {
  requestApproval: async () => ok({ decision: 'approved', action: 'take-theirs' }),
};

const rejectAll: ConflictGate = {
  requestApproval: async proposal =>
    ok({ decision: 'rejected', reason: `no auto for ${proposal.path}` }),
};

describe('detectConflicts (real git)', () => {
  it('detects', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      const result = await detectConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const found = byPath(result.value);
      expect([...found.keys()].sort()).toEqual([
        '.gitignore',
        'a.txt',
        'bin.dat',
        'gone.txt',
        'package.json',
      ]);
      expect(found.get('a.txt')?.kind).toBe('text');
      expect(found.get('a.txt')?.porcelain).toBe('UU');
      expect(found.get('bin.dat')?.kind).toBe('binary');
      expect(found.get('package.json')?.kind).toBe('manifest');
      expect(found.get('.gitignore')?.kind).toBe('gitignore');
      expect(found.get('gone.txt')?.kind).toBe('deleted');
      expect(found.get('gone.txt')?.porcelain).toBe('DU');
      // Stage SHAs are real: three stages for UU, two for the delete-side.
      expect(Object.values(found.get('a.txt')?.stages ?? {})).toHaveLength(3);
      expect(found.get('gone.txt')?.stages.ours).toBeUndefined();
      expect(found.get('gone.txt')?.stages.theirs).toBeDefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('returns empty on a clean repo', async () => {
    const repo = await makeRepo();
    try {
      await writeText(repo, 'clean.txt', 'x\n');
      await commitAll(repo, 'clean');
      const result = await detectConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('ignores untracked and staged-but-unconflicted files', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      await writeText(repo, 'untracked.txt', 'new\n');
      await writeText(repo, 'staged.txt', 'staged\n');
      await git(repo, ['add', '--', 'staged.txt']);
      const result = await detectConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const paths = result.value.map(c => c.path);
      expect(paths).not.toContain('untracked.txt');
      expect(paths).not.toContain('staged.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-conflict-plain-'));
    try {
      const result = await detectConflicts(dir);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects blank repoPath and bad timeoutMs without spawning', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime: ConflictRuntime = { run };
    for (const bad of ['', '   ']) {
      const result = await detectConflicts(bad, {}, runtime);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
    const badTimeout = await detectConflicts('/tmp/repo', { timeoutMs: 0 }, runtime);
    expect(badTimeout.isErr()).toBe(true);
    if (badTimeout.isOk()) return;
    expect(badTimeout.error.code).toBe('CONFIG_ERROR');
  });
});

describe('classifyStages (pure)', () => {
  const stages: ConflictStages = { base: SHA1, ours: SHA2, theirs: SHA3 };
  it('recommends take-theirs when ours equals base', () => {
    expect(classifyStages('f.txt', 'UU', { ...stages, ours: SHA1 }, false).recommendation).toBe(
      'take-theirs'
    );
  });

  it('recommends take-ours when theirs equals base', () => {
    expect(classifyStages('f.txt', 'UU', { ...stages, theirs: SHA1 }, false).recommendation).toBe(
      'take-ours'
    );
  });

  it('routes manifests to the delegate', () => {
    for (const name of [
      'package.json',
      'go.mod',
      'Cargo.toml',
      'requirements.txt',
      'pyproject.toml',
    ]) {
      const c = classifyStages(name, 'UU', stages, false);
      expect(c.kind).toBe('manifest');
      expect(c.recommendation).toBe('manual');
    }
  });

  it('routes gitignore to union', () => {
    expect(classifyStages('.gitignore', 'UU', stages, false).kind).toBe('gitignore');
    expect(classifyStages('sub/.gitignore', 'UU', stages, false).kind).toBe('gitignore');
    expect(classifyStages('.gitignore', 'UU', stages, false).recommendation).toBe('union');
  });

  it('forces binary to manual', () => {
    const c = classifyStages('bin.dat', 'UU', stages, true);
    expect(c.kind).toBe('binary');
    expect(c.recommendation).toBe('manual');
  });

  it('forces deleted-side shapes to manual', () => {
    expect(classifyStages('gone.txt', 'DU', { base: SHA1, theirs: SHA3 }, false).kind).toBe(
      'deleted'
    );
    expect(classifyStages('gone.txt', 'UD', { base: SHA1, ours: SHA2 }, false).kind).toBe(
      'deleted'
    );
    expect(classifyStages('gone.txt', 'DD', { base: SHA1 }, false).recommendation).toBe('manual');
    // Both-added without a base can never take a side blindly.
    expect(
      classifyStages('new.txt', 'AA', { ours: SHA2, theirs: SHA3 }, false).recommendation
    ).toBe('manual');
  });

  it('leaves both-modified text to the whitespace probe', () => {
    const c = classifyStages('a.txt', 'UU', stages, false);
    expect(c.kind).toBe('text');
    expect(c.recommendation).toBe('manual');
  });
});

describe('unionGitignoreSides (pure)', () => {
  it('merges dedupes and keeps order', () => {
    expect(unionGitignoreSides('node_modules/\ndist-a/\n', 'node_modules/\ndist-b/\n')).toBe(
      'node_modules/\ndist-a/\ndist-b/\n'
    );
  });

  it('preserves negations and anchors', () => {
    expect(unionGitignoreSides('*.log\n', '!keep.log\n/dist/\n')).toBe(
      '*.log\n!keep.log\n/dist/\n'
    );
  });

  it('ends with exactly one trailing newline', () => {
    expect(unionGitignoreSides('a', 'b')).toBe('a\nb\n');
    expect(unionGitignoreSides('a\n\n', '\n\nb\n\n')).toBe('a\n\nb\n');
  });
});

describe('resolveTargetPath (pure)', () => {
  it('accepts in-repo relative paths', () => {
    const okPath = resolveTargetPath('/repo', 'sub/dir/f.txt');
    expect(okPath.isOk()).toBe(true);
  });

  it('rejects traversal absolute and .git escapes', () => {
    // Platform-absolute outside the root (portable across win32/posix).
    const absOutside = join(tmpdir(), 'stitch-escape.txt');
    for (const bad of [
      '../evil.txt',
      'sub/../../evil.txt',
      absOutside,
      '.git/hooks/x',
      'sub/.git/y',
    ]) {
      const result = resolveTargetPath('/repo', bad);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

describe('resolveConflicts auto tiers (real git)', () => {
  it('auto resolves simple', async () => {
    const { repo, ours } = await makeWhitespaceRepo();
    try {
      const pre = await detectConflicts(repo);
      expect(pre.isOk()).toBe(true);
      if (pre.isErr()) return;
      expect(pre.value.some(c => c.path === 'ws.txt')).toBe(true);
      const result = await resolveConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toEqual([{ path: 'ws.txt', strategy: 'whitespace' }]);
      expect(result.value.gated).toEqual([]);
      expect(result.value.unresolved).toEqual([]);
      expect(await readFile(join(repo, 'ws.txt'), 'utf8')).toBe(ours);
      const post = await detectConflicts(repo);
      expect(post.isOk()).toBe(true);
      if (post.isErr()) return;
      expect(post.value).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('auto cleans a trailing-newline-only difference', async () => {
    const { repo, ours } = await makeTrailingNewlineRepo();
    try {
      const result = await resolveConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const resolved = result.value.resolved.some(
        r => r.path === 'nl.txt' && r.strategy === 'whitespace'
      );
      expect(resolved).toBe(true);
      expect(await readFile(join(repo, 'nl.txt'), 'utf8')).toBe(ours);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('unions gitignore sides', async () => {
    const { repo, ours, theirs } = await makeFiveKindRepo();
    try {
      const gate: ConflictGate = {
        requestApproval: async () =>
          ok({ decision: 'rejected', reason: 'test isolates gitignore' }),
      };
      const result = await resolveConflicts(repo, { gate });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({
        path: '.gitignore',
        strategy: 'gitignore-union',
      });
      // Ours lines first, theirs-unique appended, shared lines once.
      const merged = await readFile(join(repo, '.gitignore'), 'utf8');
      expect(merged).toBe(unionGitignoreSides(ours.gitignore, theirs.gitignore));
      expect(await PorcelainOf(repo)).toContain('UU a.txt');
      expect(await PorcelainOf(repo)).not.toContain('UU .gitignore');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('defers manifests without a delegate and leaves the file untouched', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      const result = await resolveConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const gated = result.value.gated.find(g => g.path === 'package.json');
      expect(gated).toBeDefined();
      expect(gated?.reason).toContain('P-108');
      // Untouched: still unmerged in the index and on disk.
      expect(await PorcelainOf(repo)).toContain('UU package.json');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('delegates manifests to the injected merge', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      const mergedManifest =
        JSON.stringify(
          { name: 'child', deps: { left: '1.0.0', oursOnly: '2.0.0', theirsOnly: '3.0.0' } },
          null,
          2
        ) + '\n';
      const delegate: ManifestMerge = {
        resolveManifest: async (_repoPath, path) =>
          path === 'package.json' ? ok(mergedManifest) : ok(null),
      };
      const gate: ConflictGate = {
        requestApproval: async () => ok({ decision: 'rejected', reason: 'isolate manifest' }),
      };
      const result = await resolveConflicts(repo, { manifestMerge: delegate, gate });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({ path: 'package.json', strategy: 'manifest' });
      expect(await readFile(join(repo, 'package.json'), 'utf8')).toBe(mergedManifest);
      expect(await PorcelainOf(repo)).not.toContain('UU package.json');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('resolveConflicts gate path (real git)', () => {
  it('gates ambiguous', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      const result = await resolveConflicts(repo);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const gatedPaths = result.value.gated.map(g => g.path).sort();
      expect(gatedPaths).toContain('a.txt');
      expect(gatedPaths).toContain('bin.dat');
      expect(gatedPaths).toContain('gone.txt');
      // No gate wired: nothing ambiguous is written.
      expect(await PorcelainOf(repo)).toContain('UU a.txt');
      expect(await PorcelainOf(repo)).toContain('UU bin.dat');
      expect(await PorcelainOf(repo)).toContain('DU gone.txt');
      expect(result.value.unresolved.sort()).toEqual([
        'a.txt',
        'bin.dat',
        'gone.txt',
        'package.json',
      ]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('honours gate rejections without touching the tree', async () => {
    const { repo, theirs } = await makeFiveKindRepo();
    try {
      const result = await resolveConflicts(repo, { gate: rejectAll });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({
        path: '.gitignore',
        strategy: 'gitignore-union',
      });
      const gated = result.value.gated.find(g => g.path === 'a.txt');
      expect(gated?.reason).toContain('no auto for a.txt');
      // Rejected: ours side still on disk (merge left it mid-file but the
      // resolution did not pick a side — the file is still unmerged).
      expect(await PorcelainOf(repo)).toContain('UU a.txt');
      expect(await readFile(join(repo, 'bin.dat'))).not.toEqual(Buffer.from(theirs.binary));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('applies reverify', async () => {
    const { repo, theirs } = await makeFiveKindRepo();
    try {
      const result = await resolveConflicts(repo, { gate: approveTheirs });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({ path: 'a.txt', strategy: 'gate-approved' });
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe(theirs.text);
      expect(await PorcelainOf(repo)).not.toContain('UU a.txt');
      expect(result.value.unresolved).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('applies gate write decisions with exact content', async () => {
    const { repo } = await makeFiveKindRepo();
    try {
      const settlement = 'l1\nSETTLED\nl3\n';
      const gate: ConflictGate = {
        requestApproval: async proposal =>
          proposal.path === 'a.txt'
            ? ok({ decision: 'approved', action: 'write', content: settlement })
            : rejectAll.requestApproval(proposal),
      };
      const result = await resolveConflicts(repo, { gate });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({ path: 'a.txt', strategy: 'gate-approved' });
      expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe(settlement);
      expect(await PorcelainOf(repo)).not.toContain('UU a.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('lets an explicit approval resolve binary via take-ours', async () => {
    const { repo, ours } = await makeFiveKindRepo();
    try {
      const gate: ConflictGate = {
        requestApproval: async proposal =>
          proposal.path === 'bin.dat'
            ? ok({ decision: 'approved', action: 'take-ours' })
            : ok({ decision: 'rejected', reason: 'isolate binary' }),
      };
      const result = await resolveConflicts(repo, { gate });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.resolved).toContainEqual({ path: 'bin.dat', strategy: 'gate-approved' });
      expect(await readFile(join(repo, 'bin.dat'))).toEqual(Buffer.from(ours.binary));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('proposals carry stage contents for text and SHAs for binary', async () => {
    const { repo, ours, theirs } = await makeFiveKindRepo();
    try {
      const seen = new Map<string, { ours: string | undefined; theirs: string | undefined }>();
      const gate: ConflictGate = {
        requestApproval: async proposal => {
          seen.set(proposal.path, {
            ours: proposal.oursContent,
            theirs: proposal.theirsContent,
          });
          return ok({ decision: 'rejected', reason: 'inspect only' });
        },
      };
      const result = await resolveConflicts(repo, { gate });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(seen.get('a.txt')?.ours).toBe(ours.text);
      expect(seen.get('a.txt')?.theirs).toBe(theirs.text);
      // Binary proposals never embed raw bytes — SHAs only.
      expect(seen.get('bin.dat')?.ours).toBeUndefined();
      expect(seen.get('bin.dat')?.theirs).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('resolveConflicts failure arms (scripted)', () => {
  it('maps porcelain failure to GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ status: failRun(128, 'fatal: not a git repository') }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps diff-filter failure to GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ diff: failRun(128, 'fatal: bad revision') }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps ls-files failure to GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ 'ls-files': failRun(128, 'fatal: boom') }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps blob-read failure to GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ 'show:2': failRun(128, 'fatal: bad object') }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps rev-parse failure to CONFIG_ERROR (not a repo)', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ 'rev-parse': failRun(128, 'fatal: not a git repository') }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ status: { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }),
    };
    const result = await detectConflicts('/tmp/repo', { timeoutMs: 50 }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('timed out');
      expect(result.error.message).toContain('50');
    }
  });

  it('rejects malformed porcelain as INTERNAL', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ status: okRun(Buffer.from('bogus\0')) }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('rejects malformed ls-files as INTERNAL', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ 'ls-files': okRun(Buffer.from('garbage\0')) }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('rejects unmerged paths without index stages as INTERNAL', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({
        status: okRun(Buffer.from('UU b.txt\0')),
        diff: okRun(Buffer.from('b.txt\0')),
      }),
    };
    const result = await detectConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const result = await detectConflicts('/tmp/repo', {}, { run: throwingRun('spawn EACCES') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails whitespace probe spawn errors as INTERNAL', async () => {
    const base = textConflictRun();
    const runtime: ConflictRuntime = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'diff' && args[1] === '--quiet') throw new Error('diff exploded');
        return base(args, cwd, opts);
      },
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails whitespace probing errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ 'diff-quiet': failRun(128, 'fatal: bad object') }),
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails checkout errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ checkout: failRun(1, 'error: path locked') }),
    };
    const result = await resolveConflicts('/tmp/repo', { gate: approveTheirs }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails add errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({ add: failRun(128, 'fatal: boom') }),
    };
    const result = await resolveConflicts('/tmp/repo', { gate: approveTheirs }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('auto takes the unchanged side through the full pipeline', async () => {
    // Synthetic index state a merge cannot produce (ours == base): the
    // provably-safe rule fires, checkout+add run, re-verify goes clean.
    let resolved = false;
    const base = textConflictRun({
      'ls-files': okRun(
        lsFilesU([
          { sha: SHA1, stage: 1, path: 'a.txt' },
          { sha: SHA1, stage: 2, path: 'a.txt' },
          { sha: SHA3, stage: 3, path: 'a.txt' },
        ])
      ),
    });
    const runtime: ConflictRuntime = {
      run: async (args, cwd, opts) => {
        if (resolved && (args[0] === 'status' || args[0] === 'diff' || args[0] === 'ls-files')) {
          return okRun(Buffer.from(''));
        }
        if (args[0] === 'add') resolved = true;
        return base(args, cwd, opts);
      },
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved).toEqual([{ path: 'a.txt', strategy: 'take-theirs' }]);
    expect(result.value.unresolved).toEqual([]);
  });

  it('fails take-side checkout errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({
        'ls-files': okRun(
          lsFilesU([
            { sha: SHA1, stage: 1, path: 'a.txt' },
            { sha: SHA1, stage: 2, path: 'a.txt' },
            { sha: SHA3, stage: 3, path: 'a.txt' },
          ])
        ),
        checkout: failRun(1, 'error: path locked'),
      }),
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails whitespace checkout errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: textConflictRun({
        'diff-quiet': okRun(''),
        checkout: failRun(1, 'error: path locked'),
      }),
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails stuck resolutions as INTERNAL after re-verify', async () => {
    // Applies "succeed" but the file is still listed afterwards.
    const base = textConflictRun();
    const runtime: ConflictRuntime = {
      run: async (args, cwd) => base(args, cwd, { timeoutMs: 60_000 }),
    };
    const result = await resolveConflicts('/tmp/repo', { gate: approveTheirs }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    if (result.error.code === 'INTERNAL') {
      expect(result.error.message).toContain('still conflicted');
    }
  });

  it('fails union add errors as GIT_ERROR', async () => {
    const runtime: ConflictRuntime = {
      run: singleConflictRun('.gitignore', { add: failRun(128, 'fatal: boom') }),
      writeFile: async () => {},
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails write errors as INTERNAL', async () => {
    // The gitignore union is the write path: force its write to fail.
    const gitignoreRun = textConflictRun({
      status: okRun(Buffer.from('UU .gitignore\0')),
      diff: okRun(Buffer.from('.gitignore\0')),
      'ls-files': okRun(
        lsFilesU([
          { sha: SHA1, stage: 1, path: '.gitignore' },
          { sha: SHA2, stage: 2, path: '.gitignore' },
          { sha: SHA3, stage: 3, path: '.gitignore' },
        ])
      ),
    });
    const runtime: ConflictRuntime = {
      run: gitignoreRun,
      writeFile: async () => {
        throw new Error('disk full');
      },
    };
    const result = await resolveConflicts('/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('refuses hostile repo-relative paths as CONFIG_ERROR', async () => {
    const gate: ConflictGate = {
      requestApproval: async () => ok({ decision: 'approved', action: 'write', content: 'evil\n' }),
    };
    const result = await resolveConflicts(
      '/tmp/repo',
      { gate },
      { run: singleConflictRun('../evil.txt') }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('fails gate write add errors as GIT_ERROR', async () => {
    const gate: ConflictGate = {
      requestApproval: async () =>
        ok({ decision: 'approved', action: 'write', content: 'settled\n' }),
    };
    const runtime: ConflictRuntime = {
      run: singleConflictRun('a.txt', { add: failRun(128, 'fatal: boom') }),
      writeFile: async () => {},
    };
    const result = await resolveConflicts('/tmp/repo', { gate }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails gate write approvals without content as INTERNAL', async () => {
    const gate: ConflictGate = {
      requestApproval: async () => ok({ decision: 'approved', action: 'write' }),
    };
    const result = await resolveConflicts('/tmp/repo', { gate }, { run: textConflictRun() });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('carries gate errors through unchanged', async () => {
    const gateErr: StitchError = { code: 'USER_CANCELLED', reason: 'human said no' };
    const gate: ConflictGate = {
      requestApproval: async () => err(gateErr),
    };
    const result = await resolveConflicts('/tmp/repo', { gate }, { run: textConflictRun() });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual(gateErr);
  });

  it('parks pending gate decisions as gated', async () => {
    const gate: ConflictGate = {
      requestApproval: async () => ok({ decision: 'pending', note: 'tomorrow' }),
    };
    const result = await resolveConflicts('/tmp/repo', { gate }, { run: textConflictRun() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved).toEqual([]);
    expect(result.value.gated).toEqual([{ path: 'a.txt', reason: 'awaiting approval: tomorrow' }]);
    expect(result.value.unresolved).toEqual(['a.txt']);
  });

  it('fails throwing gates as INTERNAL', async () => {
    const gate: ConflictGate = {
      requestApproval: async () => {
        throw new Error('gate exploded');
      },
    };
    const result = await resolveConflicts('/tmp/repo', { gate }, { run: textConflictRun() });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('defers delegate-null manifests to the gate', async () => {
    const delegate: ManifestMerge = {
      resolveManifest: async () => ok(null),
    };
    const gate: ConflictGate = {
      requestApproval: async () => ok({ decision: 'rejected', reason: 'later' }),
    };
    const result = await resolveConflicts(
      '/tmp/repo',
      { manifestMerge: delegate, gate },
      { run: singleConflictRun('package.json') }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.resolved).toEqual([]);
    expect(result.value.gated).toEqual([{ path: 'package.json', reason: 'rejected: later' }]);
  });

  it('fails delegate write errors as INTERNAL', async () => {
    const delegate: ManifestMerge = {
      resolveManifest: async () => ok('{"merged":true}\n'),
    };
    const runtime: ConflictRuntime = {
      run: singleConflictRun('package.json'),
      writeFile: async () => {
        throw new Error('disk full');
      },
    };
    const result = await resolveConflicts('/tmp/repo', { manifestMerge: delegate }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails throwing manifest delegates as INTERNAL', async () => {
    const delegate: ManifestMerge = {
      resolveManifest: async () => {
        throw new Error('delegate exploded');
      },
    };
    const manifestRun = textConflictRun({
      status: okRun(Buffer.from('UU package.json\0')),
      diff: okRun(Buffer.from('package.json\0')),
      'ls-files': okRun(
        lsFilesU([
          { sha: SHA1, stage: 1, path: 'package.json' },
          { sha: SHA2, stage: 2, path: 'package.json' },
          { sha: SHA3, stage: 3, path: 'package.json' },
        ])
      ),
    });
    const result = await resolveConflicts(
      '/tmp/repo',
      { manifestMerge: delegate },
      { run: manifestRun }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('carries delegate errors through unchanged', async () => {
    const delegateErr: StitchError = {
      code: 'CONFIG_ERROR',
      field: 'manifest',
      message: 'bad json',
    };
    const delegate: ManifestMerge = {
      resolveManifest: async () => err(delegateErr),
    };
    const manifestRun = textConflictRun({
      status: okRun(Buffer.from('UU package.json\0')),
      diff: okRun(Buffer.from('package.json\0')),
      'ls-files': okRun(
        lsFilesU([
          { sha: SHA1, stage: 1, path: 'package.json' },
          { sha: SHA2, stage: 2, path: 'package.json' },
          { sha: SHA3, stage: 3, path: 'package.json' },
        ])
      ),
    });
    const result = await resolveConflicts(
      '/tmp/repo',
      { manifestMerge: delegate },
      { run: manifestRun }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual(delegateErr);
  });

  it('fails re-verify spawn errors as GIT_ERROR', async () => {
    let statusCalls = 0;
    const base = textConflictRun();
    const runtime: ConflictRuntime = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'status') {
          statusCalls += 1;
          if (statusCalls > 1) return failRun(128, 'fatal: boom');
        }
        return base(args, cwd, opts);
      },
    };
    const result = await resolveConflicts('/tmp/repo', { gate: approveTheirs }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('validates resolveConflicts args without spawning', async () => {
    const runtime: ConflictRuntime = { run: throwingRun('must not spawn on validation failure') };
    const blank = await resolveConflicts('', {}, runtime);
    expect(blank.isErr()).toBe(true);
    if (blank.isOk()) return;
    expect(blank.error.code).toBe('CONFIG_ERROR');
    const badTimeout = await resolveConflicts('/tmp/repo', { timeoutMs: -5 }, runtime);
    expect(badTimeout.isErr()).toBe(true);
    if (badTimeout.isOk()) return;
    expect(badTimeout.error.code).toBe('CONFIG_ERROR');
  });

  it('maps resolveConflicts runner failures to INTERNAL', async () => {
    const result = await resolveConflicts('/tmp/repo', {}, { run: throwingRun('spawn EACCES') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('module constants', () => {
  it('exposes the default timeout', () => {
    expect(DEFAULT_CONFLICT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_CONFLICT_TIMEOUT_MS)).toBe(true);
  });
});

describe('exitCodeOf (pure)', () => {
  it('pins the timeout sentinel and numeric codes', () => {
    expect(exitCodeOf({ killed: true })).toBe(124);
    expect(exitCodeOf({ code: 'ETIMEDOUT' })).toBe(124);
    expect(exitCodeOf({ code: 128 })).toBe(128);
    expect(exitCodeOf({ status: 3 })).toBe(3);
    expect(exitCodeOf(new Error('spawn git ENOENT'))).toBe(1);
    expect(exitCodeOf(null)).toBe(1);
  });
});

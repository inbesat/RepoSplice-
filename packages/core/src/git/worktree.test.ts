// Staging worktree writes (P-076): full suite. Real git proves the
// lifecycle (add --detach, file layout, remove --force with untracked
// files, membership guards); scripted runners prove every failure arm;
// pure unit tests prove the porcelain parser.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted/pure tests keep the
// strict default as a canary.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { err, ok } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import {
  writeToWorktree,
  removeWorktree,
  parseWorktreeList,
  samePath,
  exitCodeOf,
  DEFAULT_WORKTREE_TIMEOUT_MS,
  type VerifyTree,
  type WorktreeFs,
  type WorktreeRunResult,
  type WorktreeRunner,
  type WorktreeRuntime,
} from './worktree.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-worktree-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  return repo;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function worktreePaths(repo: string): Promise<string[]> {
  const out = await git(repo, ['worktree', 'list', '--porcelain']);
  return out
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim());
}

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): WorktreeRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): WorktreeRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const LIST_MAIN = Buffer.from('worktree /tmp/repo\nHEAD abc123\nbranch refs/heads/main\n\n');
const LIST_WITH_WT = Buffer.from(
  'worktree /tmp/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /tmp/wt\nHEAD abc123\ndetached\n\n'
);

function scriptedRun(
  handler: (args: readonly string[], cwd: string) => WorktreeRunResult
): WorktreeRunner {
  return async (args, cwd) => handler(args, cwd);
}

/** Standard happy path: repo check, free target, add ok, list with tree. */
function happyRun(overrides: Partial<Record<string, WorktreeRunResult>> = {}): WorktreeRunner {
  const table: Record<string, WorktreeRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    'worktree:add': okRun('HEAD is now at abc123 base\n'),
    'worktree:list': okRun(LIST_WITH_WT),
    'worktree:remove': okRun(''),
    ...overrides,
  };
  return scriptedRun(args => {
    const key = args[0] === 'worktree' ? `worktree:${String(args[1])}` : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  });
}

function throwingRun(message: string): WorktreeRunner {
  return scriptedRun(() => {
    throw new Error(message);
  });
}

const recordingFs: () => {
  fs: WorktreeFs;
  written: Map<string, string>;
  removedDirs: string[];
} = () => {
  const written = new Map<string, string>();
  const removedDirs: string[] = [];
  const fs: WorktreeFs = {
    exists: async () => false,
    writeFiles: async targets => {
      for (const target of targets) written.set(target.path, target.content);
    },
    removeDir: async path => {
      removedDirs.push(path);
    },
    makeTempDir: async () => '/tmp/wt',
  };
  return { fs, written, removedDirs };
};

/** Git prints worktree paths with forward slashes; normalize for compares. */
function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('writeToWorktree (real git)', () => {
  it('writes files', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const files = new Map([
        ['src/a.ts', 'export const a = 1;\n'],
        ['docs/nested/b.md', '# b\n'],
      ]);
      const result = await writeToWorktree(repo, files);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.created).toBe(true);
      expect(result.value.verified).toBe(false);
      const dir = result.value.worktreePath;
      try {
        expect(await readFile(join(dir, 'src/a.ts'), 'utf8')).toBe('export const a = 1;\n');
        expect(await readFile(join(dir, 'docs/nested/b.md'), 'utf8')).toBe('# b\n');
        // The main checkout is untouched: no new files leaked in.
        expect(await exists(join(repo, 'src/a.ts'))).toBe(false);
        // Detached and registered.
        const head = await git(dir, ['rev-parse', 'HEAD']);
        const mainHead = await git(repo, ['rev-parse', 'HEAD']);
        expect(head).toBe(mainHead);
        expect(await worktreePaths(repo)).toContain(posix(dir));
      } finally {
        const removed = await removeWorktree(repo, dir);
        expect(removed.isOk()).toBe(true);
      }
      expect(await worktreePaths(repo)).not.toContain(posix(dir));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('writes at an explicit ref', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'one']);
      const first = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['commit', '--allow-empty', '-qm', 'two']);
      const result = await writeToWorktree(repo, new Map([['f.txt', 'x\n']]), { ref: first });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      try {
        expect(await git(result.value.worktreePath, ['rev-parse', 'HEAD'])).toBe(first);
      } finally {
        await removeWorktree(repo, result.value.worktreePath);
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses an occupied explicit target (real fs)', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const target = await mkdtemp(join(tmpdir(), 'stitch-wt-occupied-'));
      const result = await writeToWorktree(repo, new Map([['f.txt', 'x']]), {
        worktreePath: target,
      });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('worktreePath');
      }
      expect(await worktreePaths(repo)).toHaveLength(1);
      await rm(target, { recursive: true, force: true });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects traversal', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      // Platform-absolute outside the tree (portable across win32/posix).
      const absOutside = join(tmpdir(), 'stitch-escape.txt');
      for (const bad of ['../evil.txt', 'sub/../../evil.txt', absOutside]) {
        const result = await writeToWorktree(repo, new Map([[bad, 'evil']]));
        expect(result.isErr()).toBe(true);
        if (result.isOk()) continue;
        expect(result.error.code).toBe('CONFIG_ERROR');
      }
      // Nothing was created for the refused writes.
      expect(await worktreePaths(repo)).toHaveLength(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('git protected', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      for (const bad of ['.git/hooks/x', 'sub/.git/y']) {
        const result = await writeToWorktree(repo, new Map([[bad, 'evil']]));
        expect(result.isErr()).toBe(true);
        if (result.isOk()) continue;
        expect(result.error.code).toBe('CONFIG_ERROR');
      }
      expect(await worktreePaths(repo)).toHaveLength(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('discards', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const created = await writeToWorktree(repo, new Map([['f.txt', 'work\n']]));
      expect(created.isOk()).toBe(true);
      if (created.isErr()) return;
      const dir = created.value.worktreePath;
      // Dirt inside the tree must not survive abandonment: an unpushed
      // commit ahead plus an untracked file.
      await git(dir, ['commit', '--allow-empty', '-qm', 'should vanish']);
      await writeFile(join(dir, 'junk.txt'), 'junk\n');
      const removed = await removeWorktree(repo, dir);
      expect(removed.isOk()).toBe(true);
      expect(await exists(dir)).toBe(false);
      expect(await worktreePaths(repo)).not.toContain(posix(dir));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses an unknown ref', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      // Explicit target: the failed add must not leave a stray directory.
      const target = join(tmpdir(), 'stitch-wt-badref');
      await rm(target, { recursive: true, force: true });
      const result = await writeToWorktree(repo, new Map([['f.txt', 'x']]), {
        ref: 'no-such-ref',
        worktreePath: target,
      });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      expect(await exists(target)).toBe(false);
      expect(await worktreePaths(repo)).toHaveLength(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-worktree-plain-'));
    try {
      const result = await writeToWorktree(dir, new Map([['f.txt', 'x']]));
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('verifies through the injected port', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const seen: string[] = [];
      const verify: VerifyTree = async worktreePath => {
        seen.push(worktreePath);
        return ok({ pass: true, detail: 'build ok' });
      };
      const result = await writeToWorktree(repo, new Map([['f.txt', 'x\n']]), { verify });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.verified).toBe(true);
      expect(seen).toEqual([result.value.worktreePath]);
      await removeWorktree(repo, result.value.worktreePath);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps files on a failing verdict without erroring', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const verify: VerifyTree = async () => ok({ pass: false, detail: 'type error' });
      const result = await writeToWorktree(repo, new Map([['f.txt', 'x\n']]), { verify });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.verified).toBe(false);
      // Files stay for the fix loop (P-163 iterates on verdicts).
      expect(await readFile(join(result.value.worktreePath, 'f.txt'), 'utf8')).toBe('x\n');
      await removeWorktree(repo, result.value.worktreePath);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('removeWorktree guards (real git)', () => {
  it('refuses the main tree and unregistered paths', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const main = await removeWorktree(repo, repo);
      expect(main.isErr()).toBe(true);
      if (main.isOk()) return;
      expect(main.error.code).toBe('CONFIG_ERROR');
      const stray = join(tmpdir(), 'stitch-not-a-worktree');
      const unknown = await removeWorktree(repo, stray);
      expect(unknown.isErr()).toBe(true);
      if (unknown.isOk()) return;
      expect(unknown.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('writeToWorktree validation (no spawn)', () => {
  it('rejects blank repoPath, empty files, blank rels, and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const fs = recordingFs().fs;
    const runtime: WorktreeRuntime = { run, fs };
    for (const call of [
      () => writeToWorktree('', new Map([['f.txt', 'x']]), {}, runtime),
      () => writeToWorktree('/tmp/repo', new Map(), {}, runtime),
      () => writeToWorktree('/tmp/repo', new Map([['   ', 'x']]), {}, runtime),
      () => writeToWorktree('/tmp/repo', new Map([['f.txt', 'x']]), { timeoutMs: 0 }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

describe('parseWorktreeList (pure)', () => {
  it('parses main-only and multi-tree output', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(parseWorktreeList('worktree /tmp/repo\nHEAD abc\nbranch refs/heads/main\n\n')).toEqual([
      '/tmp/repo',
    ]);
    expect(parseWorktreeList(LIST_WITH_WT.toString('utf8'))).toEqual(['/tmp/repo', '/tmp/wt']);
  });

  it('ignores bare and non-worktree lines', () => {
    const out = 'worktree /tmp/repo\nHEAD abc\nbare\n\nworktree /tmp/wt\nHEAD def\ndetached\n\n';
    expect(parseWorktreeList(out)).toEqual(['/tmp/repo', '/tmp/wt']);
  });
});

describe('samePath and exitCodeOf (pure)', () => {
  it('compares case-insensitively on Windows and macOS only', () => {
    expect(samePath('/repo/A', '/repo/a', 'win32')).toBe(true);
    expect(samePath('/repo/A', '/repo/a', 'darwin')).toBe(true);
    expect(samePath('/repo/A', '/repo/a', 'linux')).toBe(false);
    expect(samePath('/repo/a', '/repo/a', 'linux')).toBe(true);
    expect(samePath('/repo/a', '/repo/b', 'win32')).toBe(false);
  });

  it('pins the timeout sentinel and numeric codes', () => {
    expect(exitCodeOf({ killed: true })).toBe(124);
    expect(exitCodeOf({ code: 'ETIMEDOUT' })).toBe(124);
    expect(exitCodeOf({ code: 128 })).toBe(128);
    expect(exitCodeOf({ status: 3 })).toBe(3);
    expect(exitCodeOf(new Error('spawn git ENOENT'))).toBe(1);
    expect(exitCodeOf(null)).toBe(1);
  });
});

describe('writeToWorktree failure arms (scripted)', () => {
  const files = new Map([['src/a.ts', 'x\n']]);

  it('maps rev-parse failure to CONFIG_ERROR (not a repo)', async () => {
    const { fs } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      {},
      { run: happyRun({ 'rev-parse': failRun(128, 'fatal: not a git repository') }), fs }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps rev-parse other failures to GIT_ERROR', async () => {
    const { fs } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      {},
      { run: happyRun({ 'rev-parse': failRun(1, 'spawn git ENOENT') }), fs }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const { fs } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      { timeoutMs: 50 },
      { run: happyRun({ 'rev-parse': { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }), fs }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('timed out');
      expect(result.error.message).toContain('50');
    }
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const { fs } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      {},
      { run: throwingRun('spawn EACCES'), fs }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('refuses an occupied target without spawning git add', async () => {
    const fs: WorktreeFs = {
      exists: async () => true,
      writeFiles: async () => {
        throw new Error('must not write when the target is occupied');
      },
      removeDir: async () => {
        throw new Error('must not remove when the target is occupied');
      },
      makeTempDir: async () => {
        throw new Error('must not allocate when the target is explicit');
      },
    };
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      { worktreePath: '/tmp/occupied' },
      { run: happyRun(), fs }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('rejects non-string content, blank worktreePath, and blank ref without spawning', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const { fs } = recordingFs();
    const runtime: WorktreeRuntime = { run, fs };
    const nonString = new Map<string, string>([['f.txt', 42 as unknown as string]]);
    for (const call of [
      () => writeToWorktree('/tmp/repo', nonString, {}, runtime),
      () => writeToWorktree('/tmp/repo', files, { worktreePath: '   ' }, runtime),
      () => writeToWorktree('/tmp/repo', files, { ref: '' }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('fails worktree-add spawn errors as INTERNAL', async () => {
    const base = happyRun();
    const { fs } = recordingFs();
    const runtime: WorktreeRuntime = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'worktree') throw new Error('spawn EACCES');
        return base(args, cwd, opts);
      },
      fs,
    };
    const result = await writeToWorktree('/tmp/repo', files, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails target-check errors as INTERNAL', async () => {
    const runtime: WorktreeRuntime = {
      run: happyRun(),
      fs: {
        exists: async () => {
          throw new Error('stat EACCES');
        },
        writeFiles: async () => {},
        removeDir: async () => {},
        makeTempDir: async () => '/tmp/wt',
      },
    };
    const result = await writeToWorktree('/tmp/repo', files, { worktreePath: '/tmp/wt' }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails tempdir errors as INTERNAL', async () => {
    const runtime: WorktreeRuntime = {
      run: happyRun(),
      fs: {
        exists: async () => false,
        writeFiles: async () => {},
        removeDir: async () => {},
        makeTempDir: async () => {
          throw new Error('tmp full');
        },
      },
    };
    const result = await writeToWorktree('/tmp/repo', files, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps worktree-add failure to GIT_ERROR', async () => {
    const { fs, written } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      {},
      {
        run: happyRun({ 'worktree:add': failRun(128, "fatal: '/tmp/wt' already exists") }),
        fs,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    expect(written.size).toBe(0);
  });

  it('maps bad-ref failure to CONFIG_ERROR', async () => {
    const { fs, written } = recordingFs();
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      {},
      {
        run: happyRun({ 'worktree:add': failRun(128, 'fatal: invalid reference: no-such-ref') }),
        fs,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    if (result.error.code === 'CONFIG_ERROR') {
      expect(result.error.field).toBe('ref');
    }
    expect(written.size).toBe(0);
  });

  it('cleans up the tree when staging fails', async () => {
    const run = happyRun();
    const removedDirs: string[] = [];
    const runtime: WorktreeRuntime = {
      run: async (args, cwd, opts) => run(args, cwd, opts),
      fs: {
        exists: async () => false,
        writeFiles: async () => {
          throw new Error('disk full');
        },
        removeDir: async path => {
          removedDirs.push(path);
        },
        makeTempDir: async () => '/tmp/wt',
      },
    };
    // Explicit target inside the scripted list so cleanup can find it.
    const result = await writeToWorktree('/tmp/repo', files, { worktreePath: '/tmp/wt' }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
    // The original staging error surfaces (not a cleanup error), and the
    // half-built tree was removed.
    if (result.error.code === 'INTERNAL') {
      expect(result.error.message).toContain('disk full');
    }
    expect(removedDirs).toEqual(['/tmp/wt']);
  });

  it('carries verifier errors through unchanged', async () => {
    const verifierErr: StitchError = {
      code: 'CONFIG_ERROR',
      field: 'sandbox',
      message: 'no image',
    };
    const { fs } = recordingFs();
    const verify: VerifyTree = async () => err(verifierErr);
    const result = await writeToWorktree('/tmp/repo', files, { verify }, { run: happyRun(), fs });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual(verifierErr);
  });

  it('fails throwing verifiers as INTERNAL', async () => {
    const { fs } = recordingFs();
    const verify: VerifyTree = async () => {
      throw new Error('verifier exploded');
    };
    const result = await writeToWorktree(
      '/tmp/repo',
      files,
      { verify },
      {
        run: happyRun(),
        fs,
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('removeWorktree failure arms (scripted)', () => {
  it('validates args without spawning', async () => {
    const runtime: WorktreeRuntime = { run: throwingRun('must not spawn on validation failure') };
    const blankRepo = await removeWorktree('', '/tmp/wt', {}, runtime);
    expect(blankRepo.isErr()).toBe(true);
    if (blankRepo.isOk()) return;
    expect(blankRepo.error.code).toBe('CONFIG_ERROR');
    const blankTarget = await removeWorktree('/tmp/repo', '   ', {}, runtime);
    expect(blankTarget.isErr()).toBe(true);
    if (blankTarget.isOk()) return;
    expect(blankTarget.error.code).toBe('CONFIG_ERROR');
  });

  it('refuses the main tree without listing', async () => {
    const runtime: WorktreeRuntime = { run: throwingRun('must not spawn for the main tree') };
    const result = await removeWorktree('/tmp/repo', '/tmp/repo', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('refuses unregistered paths as CONFIG_ERROR', async () => {
    const result = await removeWorktree(
      '/tmp/repo',
      '/tmp/stray',
      {},
      { run: happyRun({ 'worktree:list': okRun(LIST_MAIN) }) }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps list failure to GIT_ERROR', async () => {
    const result = await removeWorktree(
      '/tmp/repo',
      '/tmp/wt',
      {},
      {
        run: happyRun({ 'worktree:list': failRun(128, 'fatal: not a git repository') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps remove failure to GIT_ERROR', async () => {
    const result = await removeWorktree(
      '/tmp/repo',
      '/tmp/wt',
      {},
      {
        run: happyRun({ 'worktree:remove': failRun(1, 'fatal: unable to rmdir') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails an incomplete removal as INTERNAL after re-verify', async () => {
    // Remove "succeeds" but the tree is still listed: state did not move.
    const result = await removeWorktree('/tmp/repo', '/tmp/wt', {}, { run: happyRun() });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('rejects a bad timeout without spawning', async () => {
    const runtime: WorktreeRuntime = { run: throwingRun('must not spawn on validation failure') };
    const result = await removeWorktree('/tmp/repo', '/tmp/wt', { timeoutMs: 0 }, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps re-verify list failure to GIT_ERROR', async () => {
    let lists = 0;
    const base = happyRun();
    const runtime: WorktreeRuntime = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          lists += 1;
          if (lists > 1) return failRun(128, 'fatal: boom');
        }
        return base(args, cwd, opts);
      },
    };
    const result = await removeWorktree('/tmp/repo', '/tmp/wt', {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });
});

describe('module constants', () => {
  it('exposes the default timeout', () => {
    expect(DEFAULT_WORKTREE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_WORKTREE_TIMEOUT_MS)).toBe(true);
  });
});

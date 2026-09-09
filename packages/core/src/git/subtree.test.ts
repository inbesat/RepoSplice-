import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  subtreeAdd,
  selectExtractStrategy,
  DEFAULT_SUBTREE_TIMEOUT_MS,
  type ExtractStrategy,
  type SubtreeOpts,
  type SubtreeRuntime,
} from './subtree.js';
import type { GitFactoryOptions } from './factory.js';
import { generateFixtures, type FixtureSpec } from '../../../../scripts/generate-fixtures.js';

const execFileAsync = promisify(execFile);

async function probeSubtree(): Promise<boolean> {
  try {
    await execFileAsync('git', ['subtree', 'add', '-h']);
    return true;
  } catch {
    return false;
  }
}

// Collection-time gate: the add-mode tests need the git-subtree subcommand
// (shipped with full git installs incl. Git for Windows; minimal containers
// may lack it). The scripted suite below always runs.
const HAS_SUBTREE = await probeSubtree();
if (!HAS_SUBTREE) {
  console.warn('[P-073] git subtree unavailable — live subtree tests skipped.');
}

function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

const SUB_PARENT: FixtureSpec = {
  name: 'subtree-parent',
  commits: [
    {
      message: 'parent one',
      files: [{ path: 'README.md', content: { text: '# parent\n' } }],
    },
  ],
};

const SUB_CHILD: FixtureSpec = {
  name: 'subtree-child',
  commits: [
    {
      message: 'child one',
      files: [{ path: 'sub/one.txt', content: { text: 'one\n' } }],
    },
    {
      message: 'child two',
      files: [{ path: 'sub/two.txt', content: { text: 'two\n' } }],
    },
  ],
};

let fixtureRoot = '';
let childUrl = '';
let childTip = '';

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'stitch-subtree-src-'));
  const generated = await generateFixtures([SUB_PARENT, SUB_CHILD], { root: fixtureRoot });
  if (generated.isErr()) throw new Error('fixture generation failed');
  const childDir = generated.value[1];
  if (childDir === undefined) throw new Error('child fixture generated no dir');
  childUrl = toFileUrl(childDir);
  childTip = await git(childDir, ['rev-parse', 'HEAD']);
}, 60000);

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

interface SeenCalls {
  raw: string[][];
  checkIsRepo: number;
  created: GitFactoryOptions[];
}

function fakeRuntime(
  impl: {
    isRepo?: boolean;
    checkFails?: string;
    lsRemote?: (commands: string[]) => Promise<string>;
    createPrefix?: boolean;
  } = {},
  seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] }
): SubtreeRuntime {
  let baseDir = '';
  return {
    createGit: options => {
      baseDir = options.baseDir ?? '';
      seen.created.push(options);
      return {
        checkIsRepo: async () => {
          seen.checkIsRepo += 1;
          if (impl.checkFails !== undefined) throw new Error(impl.checkFails);
          return impl.isRepo ?? true;
        },
        raw: async commands => {
          seen.raw.push([...commands]);
          if (commands[0] === 'ls-remote') {
            if (impl.lsRemote !== undefined) return impl.lsRemote(commands);
            return '';
          }
          // Simulate git's side effect so the verify step passes: the
          // prefix dir appears under the parent.
          const prefixArg = commands.find(arg => arg.startsWith('--prefix='));
          if (impl.createPrefix === true && prefixArg !== undefined) {
            await mkdir(join(baseDir, prefixArg.slice('--prefix='.length)), {
              recursive: true,
            });
          }
          return '';
        },
      };
    },
  };
}

const FAKE_PARENT = '/fake/parent';
const FAKE_CHILD = 'file:///fake-child';

describe('subtreeAdd validation (no I/O)', () => {
  it('rejects bad input without spawning', async () => {
    const cases: {
      name: string;
      parent?: string;
      child?: string;
      prefix?: string;
      extra?: SubtreeOpts;
    }[] = [
      { name: 'blank parent', parent: '  ' },
      { name: 'blank child', child: '' },
      { name: 'blank prefix', prefix: ' ' },
      { name: 'absolute prefix', prefix: '/abs' },
      { name: 'traversal prefix', prefix: '../x' },
      { name: 'backslash prefix', prefix: 'a\\b' },
      { name: 'drive prefix', prefix: 'C:/x' },
      { name: 'slashes-only prefix', prefix: '///' },
      { name: 'blank branch', extra: { branch: ' ' } },
      { name: 'zero timeout', extra: { timeoutMs: 0 } },
    ];
    for (const { name, parent, child, prefix, extra } of cases) {
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent ?? FAKE_PARENT,
        child ?? FAKE_CHILD,
        prefix ?? 'child',
        extra,
        fakeRuntime({}, seen)
      );
      expect(result.isErr(), name).toBe(true);
      if (!result.isErr()) continue;
      expect(result.error.code, name).toBe('CONFIG_ERROR');
      expect(seen.raw, name).toHaveLength(0);
      expect(seen.checkIsRepo, name).toBe(0);
    }
  });
});

const SYMREF_OUTPUT = `ref: refs/heads/main\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n`;

describe('subtreeAdd preflight (scripted git, real fs)', () => {
  async function freshParent(): Promise<{ root: string; parent: string }> {
    const root = await mkdtemp(join(tmpdir(), 'stitch-subtree-'));
    return { root, parent: join(root, 'parent') };
  }

  it('refuses an existing prefix without spawning git', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(join(parent, 'child'), { recursive: true });
      await writeFile(join(parent, 'child', 'keep.txt'), 'keep\n', 'utf8');
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(parent, childUrl, 'child', undefined, fakeRuntime({}, seen));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('prefix');
      }
      expect(seen.raw).toHaveLength(0);
      expect(seen.checkIsRepo).toBe(0);
      // The pre-existing tree is untouched.
      expect(await readText(join(parent, 'child', 'keep.txt'))).toBe('keep\n');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('rejects a non-repo parent before any network', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime({ isRepo: false }, seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('not a git repository');
      }
      expect(seen.raw).toHaveLength(0);
      expect(seen.checkIsRepo).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('maps a repo check failure', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime({ checkFails: 'rev-parse blew up' }, seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('subtree repo check');
      }
      expect(seen.raw).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('rejects a missing parent before spawning', async () => {
    const { root } = await freshParent();
    try {
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        join(root, 'nope'),
        childUrl,
        'child',
        undefined,
        fakeRuntime({}, seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('parentRepo');
      }
      expect(seen.raw).toHaveLength(0);
      expect(seen.checkIsRepo).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('maps a factory failure', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const throwing: SubtreeRuntime = {
        createGit: (): never => {
          throw new Error('factory blew up');
        },
      };
      const result = await subtreeAdd(parent, childUrl, 'child', undefined, throwing);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('subtree git client init');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('ignores a malformed symref line', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime({ lsRemote: async () => 'ref: refs/tags/v1\tHEAD\n', createPrefix: true }, seen)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const add = seen.raw[1];
      expect(add).toBeDefined();
      if (add === undefined) return;
      expect(add[add.length - 1]).toBe('HEAD');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('resolves the default branch from ls-remote symref', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child/',
        undefined,
        fakeRuntime({ lsRemote: async () => SYMREF_OUTPUT, createPrefix: true }, seen)
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBe(parent);
      expect(seen.raw).toEqual([
        ['ls-remote', '--symref', childUrl, 'HEAD'],
        [
          '-c',
          'user.name=repo-stitcher',
          '-c',
          'user.email=repo-stitcher@localhost',
          '-c',
          'commit.gpgsign=false',
          'subtree',
          'add',
          '--prefix=child',
          childUrl,
          'main',
        ],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('checks an explicit branch without symref', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        { branch: 'main' },
        fakeRuntime(
          {
            lsRemote: async () => '0123456789abcdef0123456789abcdef01234567\trefs/heads/main\n',
            createPrefix: true,
          },
          seen
        )
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(seen.raw[0]).toEqual(['ls-remote', childUrl, 'main']);
      const add = seen.raw[1];
      expect(add).toBeDefined();
      if (add === undefined) return;
      expect(add[add.length - 1]).toBe('main');
      expect(add).not.toContain('--squash');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('falls back to HEAD without a symref line', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime(
          {
            lsRemote: async () => '0123456789abcdef0123456789abcdef01234567\tHEAD\n',
            createPrefix: true,
          },
          seen
        )
      );
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const add = seen.raw[1];
      expect(add).toBeDefined();
      if (add === undefined) return;
      expect(add[add.length - 1]).toBe('HEAD');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('rejects an unknown branch before adding', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        { branch: 'nope' },
        fakeRuntime({ lsRemote: async () => '' }, seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('branch');
      }
      expect(seen.raw).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('maps an unreachable child without leaking credentials', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const secretUrl = 'https://user:s3cret@example.com/r.git';
      const result = await subtreeAdd(
        parent,
        secretUrl,
        'child',
        { branch: 'main' },
        fakeRuntime(
          {
            lsRemote: async () => {
              throw new Error(`fatal: unable to connect to '${secretUrl}': timeout`);
            },
          },
          seen
        )
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('not fetchable');
      }
      expect(JSON.stringify(result.error)).not.toContain('s3cret');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('maps a subtree add failure', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const failing: SubtreeRuntime = {
        createGit: () => ({
          checkIsRepo: async () => true,
          raw: async commands => {
            if (commands[0] === 'ls-remote') return SYMREF_OUTPUT;
            throw new Error('Command failed: git subtree add\nexit code 128');
          },
        }),
      };
      const result = await subtreeAdd(parent, childUrl, 'child', undefined, failing);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('subtreeAdd failed');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('hints when the subtree subcommand is missing', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const failing: SubtreeRuntime = {
        createGit: () => ({
          checkIsRepo: async () => true,
          raw: async commands => {
            if (commands[0] === 'ls-remote') return SYMREF_OUTPUT;
            throw new Error("git: 'subtree' is not a git command. See 'git --help'.");
          },
        }),
      };
      const result = await subtreeAdd(parent, childUrl, 'child', undefined, failing);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('git-subtree');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('fails when nothing was created', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const result = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime({ lsRemote: async () => SYMREF_OUTPUT }, seen)
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('left no prefix dir');
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('plumbs the silence timeout to the git client', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(parent, { recursive: true });
      const seen: SeenCalls = { raw: [], checkIsRepo: 0, created: [] };
      const first = await subtreeAdd(
        parent,
        childUrl,
        'child',
        undefined,
        fakeRuntime({ lsRemote: async () => SYMREF_OUTPUT, createPrefix: true }, seen)
      );
      expect(first.isOk()).toBe(true);
      const custom = await subtreeAdd(
        parent,
        childUrl,
        'other',
        { timeoutMs: 5000 },
        fakeRuntime({ lsRemote: async () => SYMREF_OUTPUT, createPrefix: true }, seen)
      );
      expect(custom.isOk()).toBe(true);
      // Prefix 'child' now exists from the first run: the second run used a
      // fresh prefix, so both succeed and both factories were observed.
      expect(seen.created).toHaveLength(2);
      expect(seen.created[0]?.timeoutMs).toBe(DEFAULT_SUBTREE_TIMEOUT_MS);
      expect(seen.created[1]?.timeoutMs).toBe(5000);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});

describe('selectExtractStrategy (P-073 pure selector)', () => {
  it('strategy selects', () => {
    const cases: {
      name: string;
      available: boolean;
      prefer?: ExtractStrategy;
      strategy?: ExtractStrategy;
    }[] = [
      { name: 'filter-repo default', available: true, strategy: 'filter-repo' },
      { name: 'subtree fallback', available: false, strategy: 'subtree' },
      { name: 'explicit subtree wins', available: true, prefer: 'subtree', strategy: 'subtree' },
      {
        name: 'explicit subtree without binary',
        available: false,
        prefer: 'subtree',
        strategy: 'subtree',
      },
      {
        name: 'explicit filter-repo honored',
        available: true,
        prefer: 'filter-repo',
        strategy: 'filter-repo',
      },
    ];
    for (const { name, available, prefer, strategy } of cases) {
      const result = selectExtractStrategy({
        filterRepoAvailable: available,
        ...(prefer !== undefined ? { prefer } : {}),
      });
      expect(result.isOk(), name).toBe(true);
      if (!result.isOk()) continue;
      expect(result.value, name).toBe(strategy);
    }
    const missing = selectExtractStrategy({ filterRepoAvailable: false, prefer: 'filter-repo' });
    expect(missing.isErr()).toBe(true);
    if (!missing.isErr()) return;
    expect(missing.error.code).toBe('CONFIG_ERROR');
    // A runtime-unknown preference fails closed, never silently defaulted.
    const unknown = selectExtractStrategy({
      filterRepoAvailable: true,
      prefer: 'mercurial' as unknown as ExtractStrategy,
    });
    expect(unknown.isErr()).toBe(true);
    if (!unknown.isErr()) return;
    expect(unknown.error.code).toBe('CONFIG_ERROR');
  });
});

describe.runIf(HAS_SUBTREE)('subtreeAdd live (P-073 real git-subtree)', () => {
  async function freshParent(): Promise<{ root: string; parent: string }> {
    const root = await mkdtemp(join(tmpdir(), 'stitch-subtree-live-'));
    const generated = await generateFixtures([SUB_PARENT], { root });
    if (generated.isErr()) throw new Error('parent fixture failed');
    const parent = generated.value[0];
    if (parent === undefined) throw new Error('parent fixture generated no dir');
    // Test-side hermeticity (P-064 spirit): ambient autocrlf must not
    // rewrite the checked-out bytes the assertions compare.
    await git(parent, ['config', 'core.autocrlf', 'false']);
    return { root, parent };
  }

  it('adds squash', async () => {
    const { root, parent } = await freshParent();
    try {
      const result = await subtreeAdd(parent, childUrl, 'child', { branch: 'main', squash: true });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toBe(parent);
      expect(await readText(join(parent, 'child', 'sub', 'one.txt'))).toBe('one\n');
      expect(await readText(join(parent, 'child', 'sub', 'two.txt'))).toBe('two\n');
      expect(await readText(join(parent, 'README.md'))).toBe('# parent\n');
      const subjects = await git(parent, ['log', '--format=%s']);
      expect(subjects).toContain('Squashed');
      expect(subjects).toContain('child');
      expect(subjects).not.toContain('child one');
      expect(subjects).not.toContain('child two');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);

  it('adds history', async () => {
    const { root, parent } = await freshParent();
    try {
      const result = await subtreeAdd(parent, childUrl, 'child', { branch: 'main' });
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(await readText(join(parent, 'child', 'sub', 'one.txt'))).toBe('one\n');
      expect(await readText(join(parent, 'child', 'sub', 'two.txt'))).toBe('two\n');
      // Full history preserved verbatim, plus a provenance-rich merge whose
      // message names the prefix and the exact source tip.
      const subjects = await git(parent, ['log', '--format=%s']);
      expect(subjects).toContain('child one');
      expect(subjects).toContain('child two');
      const body = await git(parent, ['log', '--format=%B', '-1']);
      expect(body).toContain(`Add 'child/' from commit '${childTip}'`);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);

  it('prefix exists errors', async () => {
    const { root, parent } = await freshParent();
    try {
      await mkdir(join(parent, 'child'), { recursive: true });
      await writeFile(join(parent, 'child', 'keep.txt'), 'keep\n', 'utf8');
      const result = await subtreeAdd(parent, childUrl, 'child', { branch: 'main' });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('prefix');
      }
      expect(await readText(join(parent, 'child', 'keep.txt'))).toBe('keep\n');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }, 60000);
});

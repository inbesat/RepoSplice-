// Blame/provenance map foundation (P-079): full suite. Real git proves
// attribution (porcelain blocks, prefix mapping, merge-topology
// multi-origin, uncommitted lines); a fake DbLike proves persistence;
// scripted runners prove every failure arm; pure unit tests prove the
// porcelain parser byte-for-byte.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted/pure tests keep the
// strict default as a canary. No network is touched.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  buildBlameMap,
  saveBlameMap,
  loadBlameMap,
  parseBlamePorcelain,
  exitCodeOf,
  DEFAULT_BLAME_TIMEOUT_MS,
  type BlameMap,
  type BlameRunner,
  type BlameRunResult,
  type BlameSource,
} from './blameMap.js';
import type { DbLike, StatementLike, SQLiteValue } from '../store/schema.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-blame-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'First Author']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  return repo;
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', message]);
}

function byPath(map: BlameMap): Map<string, (typeof map.files)[number]> {
  return new Map(map.files.map(file => [file.path, file]));
}

// ─── In-memory DbLike fake (implements the 3 statements blameMap uses) ───

interface StoredRow {
  repo: string;
  commit_sha: string | null;
  payload: string;
}

function fakeDb(initial: StoredRow[] = []): { db: DbLike; rows: StoredRow[] } {
  const rows: StoredRow[] = [...initial];
  const statement = (sql: string): StatementLike => ({
    all: (...params: SQLiteValue[]) => {
      if (!sql.startsWith('SELECT payload FROM provenance')) {
        throw new Error(`unexpected query: ${sql}`);
      }
      const repo = params[0] as string;
      return rows.filter(row => row.repo === repo).map(row => ({ payload: row.payload }));
    },
    get: () => null,
    run: (...params: SQLiteValue[]) => {
      if (sql.startsWith('DELETE FROM provenance')) {
        const repo = params[0] as string;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.repo === repo) rows.splice(i, 1);
        }
        return { changes: 0, lastInsertRowid: 0 };
      }
      if (sql.startsWith('INSERT INTO provenance')) {
        rows.push({
          repo: params[0] as string,
          commit_sha: (params[1] as string | null) ?? null,
          payload: params[2] as string,
        });
        return { changes: 1, lastInsertRowid: rows.length };
      }
      throw new Error(`unexpected run: ${sql}`);
    },
  });
  const db: DbLike = {
    exec: () => {},
    query: statement,
    close: () => {},
  };
  return { db, rows };
}

// ─── Scripted git runner ───────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): BlameRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): BlameRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const BLOB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const LS_TWO = Buffer.from(`100644 ${BLOB} 0\ta.txt\0` + `100644 ${BLOB} 0\tb.txt\0`);

const BLAME_A_TXT = [
  `${SHA_A} 1 1 2`,
  'author Alice',
  'author-mail <alice@example.com>',
  'author-time 1700000000',
  'summary first',
  'filename a.txt',
  '\tone',
  '\ttwo',
  `${SHA_B} 3 3 1`,
  'author Bob',
  'author-mail <bob@example.com>',
  'author-time 1700000001',
  'summary second',
  'filename a.txt',
  '\tthree',
  '',
].join('\n');

function scriptedBlame(overrides: Partial<Record<string, BlameRunResult>> = {}): BlameRunner {
  const table: Record<string, BlameRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    'ls-files': okRun(LS_TWO),
    blame: okRun(BLAME_A_TXT),
    'merge-base': failRun(1, ''),
    ...overrides,
  };
  return async args => {
    const key =
      args[0] === 'blame' ? 'blame' : args[0] === 'merge-base' ? 'merge-base' : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  };
}

function throwingRun(message: string): BlameRunner {
  return async () => {
    throw new Error(message);
  };
}

describe('buildBlameMap (real git)', () => {
  it('maps origin', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'line one\nline two\n');
      await commitAll(repo, 'first');
      const map = await buildBlameMap(repo, [
        { name: 'child-src', prefix: '', ref: 'main', license: 'MIT' },
      ]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      expect(map.value.repoPath).toBe(repo);
      const files = byPath(map.value);
      expect([...files.keys()]).toEqual(['f.txt']);
      const blamed = files.get('f.txt');
      expect(blamed?.blobSha).toMatch(/^[0-9a-f]{40}$/);
      expect(blamed?.origins).toHaveLength(1);
      expect(blamed?.origins[0]).toMatchObject({
        startLine: 1,
        endLine: 2,
        author: 'First Author',
        authorMail: 'test@stitch.dev',
        sourceRepo: 'child-src',
        sourceRef: 'main',
        license: 'MIT',
      });
      expect(blamed?.origins[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('attributes by longest prefix', async () => {
    const repo = await makeRepo();
    try {
      await mkdir(join(repo, 'repo-a', 'sub'), { recursive: true });
      await writeFile(join(repo, 'repo-a', 'sub', 'deep.txt'), 'deep\n');
      await writeFile(join(repo, 'repo-a', 'top.txt'), 'top\n');
      await writeFile(join(repo, 'other.txt'), 'other\n');
      await commitAll(repo, 'base');
      const map = await buildBlameMap(repo, [
        { name: 'shallow', prefix: 'repo-a' },
        { name: 'deep', prefix: 'repo-a/sub' },
      ]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      const files = byPath(map.value);
      expect(files.get('repo-a/sub/deep.txt')?.origins[0]?.sourceRepo).toBe('deep');
      expect(files.get('repo-a/top.txt')?.origins[0]?.sourceRepo).toBe('shallow');
      // No prefix matches and no tips: honestly unknown, not fabricated.
      expect(files.get('other.txt')?.origins[0]?.sourceRepo).toBeNull();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('multi origin', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'm.txt'), 'top\nbase line\nbottom\n');
      await commitAll(repo, 'base');
      // Branch BEFORE either side advances: only post-branch-point
      // commits are exclusive to one tip (shared linear history is
      // genuinely ambiguous — no topology can split it). Changes sit on
      // separated hunks so the merge itself stays automatic.
      await git(repo, ['branch', 'side']);
      await writeFile(join(repo, 'm.txt'), 'top\nmain line\nbottom\n');
      await commitAll(repo, 'a-side');
      const shaA = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', 'side']);
      await writeFile(join(repo, 'm.txt'), 'top\nbase line\nbottom\nside line\n');
      await commitAll(repo, 'b-side');
      const shaB = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['checkout', '-q', 'main']);
      await git(repo, ['merge', '--no-ff', '--no-edit', '-q', 'side']);
      const map = await buildBlameMap(repo, [
        { name: 'src-a', tipSha: shaA },
        { name: 'src-b', tipSha: shaB },
      ]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      const blamed = byPath(map.value).get('m.txt');
      expect(blamed?.origins).toHaveLength(4);
      const bySource = new Map((blamed?.origins ?? []).map(origin => [origin.sourceRepo, origin]));
      expect(bySource.get('src-a')).toMatchObject({ startLine: 2, endLine: 2, sha: shaA });
      expect(bySource.get('src-b')).toMatchObject({ startLine: 4, endLine: 4, sha: shaB });
      // Shared-base lines stay honestly unknown.
      expect(blamed?.origins[0]).toMatchObject({ startLine: 1, endLine: 1, sourceRepo: null });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('records uncommitted lines with a null sha', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'committed\n');
      await commitAll(repo, 'base');
      await writeFile(join(repo, 'f.txt'), 'committed\nuncommitted\n');
      const map = await buildBlameMap(repo, [{ name: 's' }]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      const origins = byPath(map.value).get('f.txt')?.origins ?? [];
      expect(origins).toHaveLength(2);
      expect(origins[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(origins[1]?.sha).toBeNull();
      expect(origins[1]?.author.trim()).not.toBe('');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('returns an empty map for a fileless repo', async () => {
    const repo = await makeRepo();
    try {
      const map = await buildBlameMap(repo, [{ name: 's' }]);
      expect(map.isOk()).toBe(true);
      if (map.isErr()) return;
      expect(map.value.files).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-blame-plain-'));
    try {
      const result = await buildBlameMap(dir, [{ name: 's' }]);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('persists (fake DbLike store)', () => {
  async function realMap(): Promise<BlameMap> {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'line one\nline two\n');
      await commitAll(repo, 'first');
      await git(repo, ['config', 'user.name', 'Second Author']);
      await writeFile(join(repo, 'f.txt'), 'line one\nline TWO\n');
      await commitAll(repo, 'second');
      const built = await buildBlameMap(repo, [{ name: 's', license: 'MIT' }]);
      if (built.isErr()) throw new Error('fixture failed');
      return built.value;
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }

  it('persists', async () => {
    const map = await realMap();
    const { db, rows } = fakeDb();
    const saved = await saveBlameMap(db, map);
    expect(saved.isOk()).toBe(true);
    expect(rows).toHaveLength(map.files.length);
    expect(rows.every(row => row.repo === map.repoPath)).toBe(true);
    const loaded = await loadBlameMap(db, map.repoPath);
    expect(loaded.isOk()).toBe(true);
    if (loaded.isErr()) return;
    expect(loaded.value).toEqual(map);
  }, 30_000);

  it('replaces stale rows on re-save', async () => {
    const map = await realMap();
    const { db, rows } = fakeDb();
    expect((await saveBlameMap(db, map)).isOk()).toBe(true);
    expect((await saveBlameMap(db, map)).isOk()).toBe(true);
    // No duplicates: replace-whole-map keeps exactly one row per file.
    expect(rows).toHaveLength(map.files.length);
  }, 30_000);

  it('loads empty for an unknown repo', async () => {
    const { db } = fakeDb();
    const loaded = await loadBlameMap(db, '/tmp/never-saved');
    expect(loaded.isOk()).toBe(true);
    if (loaded.isErr()) return;
    expect(loaded.value.files).toEqual([]);
  }, 30_000);

  it('fails corrupt rows as INTERNAL', async () => {
    const { db } = fakeDb([{ repo: '/tmp/r', commit_sha: null, payload: 'not json{{' }]);
    const loaded = await loadBlameMap(db, '/tmp/r');
    expect(loaded.isErr()).toBe(true);
    if (loaded.isOk()) return;
    expect(loaded.error.code).toBe('INTERNAL');
  }, 30_000);

  it('fails misshapen rows as INTERNAL', async () => {
    const badPayloads: unknown[] = [
      '"just a string"',
      '42',
      JSON.stringify({ path: 42, blobSha: 'x', origins: [] }),
      JSON.stringify({ path: 'f', blobSha: 'x', origins: [42] }),
      JSON.stringify({ path: 'f', blobSha: 'x' }),
    ];
    for (const payload of badPayloads) {
      const { db } = fakeDb([{ repo: '/tmp/r', commit_sha: null, payload: payload as string }]);
      const loaded = await loadBlameMap(db, '/tmp/r');
      expect(loaded.isErr()).toBe(true);
      if (loaded.isOk()) continue;
      expect(loaded.error.code).toBe('INTERNAL');
    }
  });

  it('fails non-string payload rows as INTERNAL', async () => {
    const { db, rows } = fakeDb();
    rows.push({ repo: '/tmp/r', commit_sha: null, payload: 42 as unknown as string });
    const loaded = await loadBlameMap(db, '/tmp/r');
    expect(loaded.isErr()).toBe(true);
    if (loaded.isOk()) return;
    expect(loaded.error.code).toBe('INTERNAL');
  });

  it('fails insert errors as INTERNAL', async () => {
    const inserting: DbLike = {
      exec: () => {},
      query: (sql: string) => {
        if (sql.startsWith('INSERT INTO provenance')) {
          throw new Error('disk full');
        }
        return {
          all: () => [],
          get: () => null,
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        };
      },
      close: () => {},
    };
    const map: BlameMap = {
      repoPath: '/tmp/repo',
      files: [{ path: 'f.txt', blobSha: BLOB, origins: [] }],
    };
    const result = await saveBlameMap(inserting, map);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('deterministic', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'b.txt'), 'b1\nb2\n');
      await writeFile(join(repo, 'a.txt'), 'a1\n');
      await commitAll(repo, 'base');
      const first = await buildBlameMap(repo, [{ name: 's' }]);
      const second = await buildBlameMap(repo, [{ name: 's' }]);
      expect(first.isOk() && second.isOk()).toBe(true);
      if (first.isErr() || second.isErr()) return;
      expect(first.value).toEqual(second.value);
      // Sorted by path for stable exports.
      expect(first.value.files.map(file => file.path)).toEqual(['a.txt', 'b.txt']);
      const { db } = fakeDb();
      expect((await saveBlameMap(db, first.value)).isOk()).toBe(true);
      const loaded = await loadBlameMap(db, repo);
      expect(loaded.isOk()).toBe(true);
      if (loaded.isErr()) return;
      expect(loaded.value).toEqual(first.value);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('parseBlamePorcelain (pure)', () => {
  it('parses multi-block output with line ranges', () => {
    const parsed = parseBlamePorcelain(BLAME_A_TXT, 'a.txt');
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value).toHaveLength(2);
    expect(parsed.value[0]).toMatchObject({
      sha: SHA_A,
      startLine: 1,
      endLine: 2,
      author: 'Alice',
      authorMail: 'alice@example.com',
      authorTime: 1700000000,
    });
    expect(parsed.value[1]).toMatchObject({
      sha: SHA_B,
      startLine: 3,
      endLine: 3,
      author: 'Bob',
    });
  });

  it('maps all-zero SHAs to null', () => {
    const text = [
      `${'0'.repeat(40)} 1 1 1`,
      'author Not Committed Yet',
      'author-mail <test@stitch.dev>',
      'author-time 1700000002',
      'filename a.txt',
      '\tnew line',
      '',
    ].join('\n');
    const parsed = parseBlamePorcelain(text, 'a.txt');
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value[0]?.sha).toBeNull();
    expect(parsed.value[0]?.startLine).toBe(1);
  });

  it('rejects malformed blocks as INTERNAL', () => {
    for (const bad of [
      'definitely not porcelain\n',
      `${SHA_A} 1 1\n`,
      `${SHA_A} 1 1 2\nauthor Alice\n`,
      `${SHA_A} 1 1 2\nauthor Alice\nauthor-mail <a@b>\nauthor-time 1\nfilename a.txt\n\tonly one\n`,
    ]) {
      const parsed = parseBlamePorcelain(bad, 'a.txt');
      expect(parsed.isErr()).toBe(true);
      if (parsed.isOk()) continue;
      expect(parsed.error.code).toBe('INTERNAL');
    }
  });

  it('rejects zero-count blocks and missing authors as INTERNAL', () => {
    const zeroCount = [
      `${SHA_A} 1 1 0`,
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1',
      'filename a.txt',
      '',
    ].join('\n');
    expect(parseBlamePorcelain(zeroCount, 'a.txt').isErr()).toBe(true);
    const noAuthor = [
      `${SHA_A} 1 1 1`,
      'author-mail <alice@example.com>',
      'author-time 1',
      'filename a.txt',
      '\tone',
      '',
    ].join('\n');
    expect(parseBlamePorcelain(noAuthor, 'a.txt').isErr()).toBe(true);
  });

  it('rejects a header interrupting a block as INTERNAL', () => {
    const cut = [
      `${SHA_A} 1 1 2`,
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1',
      'filename a.txt',
      '\tone',
      `${SHA_B} 2 2 1`,
      'author Bob',
      'author-mail <bob@example.com>',
      'author-time 1',
      'filename a.txt',
      '\ttwo',
      '',
    ].join('\n');
    const parsed = parseBlamePorcelain(cut, 'a.txt');
    expect(parsed.isErr()).toBe(true);
    if (parsed.isOk()) return;
    expect(parsed.error.code).toBe('INTERNAL');
  });

  it('tolerates odd but legal metadata values', () => {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Alice',
      'author-mail bare-address',
      'author-time 99999999999999999999999',
      'filename a.txt',
      '\tone',
      '',
    ].join('\n');
    const parsed = parseBlamePorcelain(text, 'a.txt');
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value[0]).toMatchObject({ authorMail: 'bare-address', authorTime: null });
    const emptyMail = parseBlamePorcelain(
      text.replace('author-mail bare-address', 'author-mail <>'),
      'a.txt'
    );
    expect(emptyMail.isOk()).toBe(true);
    if (emptyMail.isErr()) return;
    expect(emptyMail.value[0]?.authorMail).toBeNull();
    const badTime = parseBlamePorcelain(
      text.replace('author-time 99999999999999999999999', 'author-time yesterday'),
      'a.txt'
    );
    expect(badTime.isOk()).toBe(true);
    if (badTime.isErr()) return;
    expect(badTime.value[0]?.authorTime).toBeNull();
  });

  it('computes final line numbers across blocks', () => {
    const text = [
      `${SHA_A} 1 1 1`,
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1',
      'filename a.txt',
      '\tone',
      `${SHA_A} 2 2 3`,
      'author Alice',
      'author-mail <alice@example.com>',
      'author-time 1',
      'filename a.txt',
      '\ttwo',
      '\tthree',
      '\tfour',
      '',
    ].join('\n');
    const parsed = parseBlamePorcelain(text, 'a.txt');
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value.map(block => [block.startLine, block.endLine])).toEqual([
      [1, 1],
      [2, 4],
    ]);
  });
});

describe('buildBlameMap validation (no spawn)', () => {
  it('rejects blank repoPath, bad sources, and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => buildBlameMap('', [{ name: 's' }], {}, runtime),
      () => buildBlameMap('/tmp/repo', [{ name: '   ' }], {}, runtime),
      () => buildBlameMap('/tmp/repo', [{ name: 's', tipSha: 'not-a-sha' }], {}, runtime),
      () => buildBlameMap('/tmp/repo', [{ name: 's' }], { timeoutMs: 0 }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });
});

describe('buildBlameMap failure arms (scripted)', () => {
  const sources: BlameSource[] = [{ name: 's' }];

  it('maps ls-files failure to GIT_ERROR', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      {
        run: scriptedBlame({ 'ls-files': failRun(128, 'fatal: bad default revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('rejects malformed ls-files as INTERNAL', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      {
        run: scriptedBlame({ 'ls-files': okRun(Buffer.from('garbage\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps blame failure to GIT_ERROR', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      {
        run: scriptedBlame({ blame: failRun(128, 'fatal: no such path') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps unparseable blame to INTERNAL', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      {
        run: scriptedBlame({ blame: okRun('garbage\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails merge-base spawn errors as INTERNAL', async () => {
    const base = scriptedBlame();
    const tipped: BlameSource[] = [{ name: 's', tipSha: SHA_B }];
    const result = await buildBlameMap(
      '/tmp/repo',
      tipped,
      {},
      {
        run: async (args, cwd, opts) => {
          if (args[0] === 'merge-base') throw new Error('spawn EACCES');
          return base(args, cwd, opts);
        },
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('treats merge-base usage errors as GIT_ERROR', async () => {
    const tipped: BlameSource[] = [{ name: 's', tipSha: SHA_B }];
    const result = await buildBlameMap(
      '/tmp/repo',
      tipped,
      {},
      {
        run: scriptedBlame({ 'merge-base': failRun(129, 'usage: git merge-base') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('treats unknown merge-base objects as non-ancestors', async () => {
    // The tip SHAs are foreign to this repo: every check answers "false",
    // so origins resolve through prefixes (none here) to honestly null —
    // not an error.
    const tipped: BlameSource[] = [{ name: 's', tipSha: SHA_B }];
    const result = await buildBlameMap(
      '/tmp/repo',
      tipped,
      {},
      {
        run: scriptedBlame({
          'merge-base': failRun(128, 'fatal: Not a valid commit name deadbeef'),
        }),
      }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    for (const file of result.value.files) {
      for (const origin of file.origins) {
        expect(origin.sourceRepo).toBeNull();
      }
    }
  });

  it('maps rev-parse failure to CONFIG_ERROR (not a repo)', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      {
        run: scriptedBlame({ 'rev-parse': failRun(128, 'fatal: not a git repository') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      { timeoutMs: 50 },
      {
        run: scriptedBlame({ 'rev-parse': { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }),
      }
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
    const result = await buildBlameMap(
      '/tmp/repo',
      sources,
      {},
      { run: throwingRun('spawn EACCES') }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });
});

describe('saveBlameMap guards (scripted store)', () => {
  it('maps store failures to INTERNAL', async () => {
    const failing: DbLike = {
      exec: () => {},
      query: () => {
        throw new Error('db locked');
      },
      close: () => {},
    };
    const map: BlameMap = { repoPath: '/tmp/repo', files: [] };
    const result = await saveBlameMap(failing, map);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps load failures to INTERNAL', async () => {
    const failing: DbLike = {
      exec: () => {},
      query: () => {
        throw new Error('db locked');
      },
      close: () => {},
    };
    const result = await loadBlameMap(failing, '/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
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

describe('module constants', () => {
  it('exposes the default timeout', () => {
    expect(DEFAULT_BLAME_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_BLAME_TIMEOUT_MS)).toBe(true);
  });
});

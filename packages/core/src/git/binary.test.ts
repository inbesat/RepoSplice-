// Binary skip list (P-082): full suite. Real git proves detection
// (gitattributes policy, NUL magic bytes, extension config) and the
// subtree carry-through; a fake DbLike proves skip persistence;
// scripted runners prove every failure arm; pure unit tests prove the
// attr-triple parser.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted/pure tests keep the
// strict default as a canary. No network is touched.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  isBinary,
  classifyFiles,
  parseCheckAttr,
  saveSkipList,
  loadSkipList,
  exitCodeOf,
  DEFAULT_BINARY_TIMEOUT_MS,
  type BinaryRunner,
  type BinaryRunResult,
  type BinaryFs,
  type SkipDecision,
} from './binary.js';
import { subtreeAdd } from './subtree.js';
import type { DbLike, StatementLike, SQLiteValue } from '../store/schema.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-binary-'));
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

// ─── In-memory DbLike fake (same 3-statement contract as P-079) ─────────

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

function okRun(stdout: string | Buffer = ''): BinaryRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): BinaryRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

/** check-attr -z triple payload builder. */
function attrTriples(path: string, attrs: Array<[string, string]>): Buffer {
  return Buffer.from(attrs.flatMap(([attr, value]) => [path, attr, value]).join('\0') + '\0');
}

function throwingRun(message: string): BinaryRunner {
  return async () => {
    throw new Error(message);
  };
}

describe('isBinary (real git)', () => {
  it('detects magic', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'data.bin'), Buffer.from([1, 2, 0, 3, 4]));
      await writeFile(join(repo, 'plain.txt'), 'just text\n');
      await commitAll(repo, 'base');
      const nul = await isBinary(repo, 'data.bin');
      expect(nul.isOk()).toBe(true);
      if (nul.isErr()) return;
      expect(nul.value).toEqual({ binary: true, reason: 'magic' });
      const text = await isBinary(repo, 'plain.txt');
      expect(text.isOk()).toBe(true);
      if (text.isErr()) return;
      expect(text.value).toEqual({ binary: false, reason: 'text' });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('honours gitattributes policy over content', async () => {
    const repo = await makeRepo();
    try {
      // Explicit binary marking on text content still skips it, and
      // -diff marks text content binary, exactly like git's own diff.
      await writeFile(join(repo, '.gitattributes'), '*.dat binary\nnodiff.dat -diff\n');
      await writeFile(join(repo, 'marked.dat'), 'plain text, no nul\n');
      await writeFile(join(repo, 'nodiff.dat'), 'plain text, no nul\n');
      await commitAll(repo, 'base');
      for (const file of ['marked.dat', 'nodiff.dat']) {
        const result = await isBinary(repo, file);
        expect(result.isOk()).toBe(true);
        if (result.isErr()) continue;
        expect(result.value).toEqual({ binary: true, reason: 'attr' });
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('matches the extension list only when configured', async () => {
    const repo = await makeRepo();
    try {
      // High bytes but no NUL: git sees text, the ext list decides.
      await writeFile(join(repo, 'photo.dat'), Buffer.from([200, 201, 202, 10]));
      await commitAll(repo, 'base');
      const configured = await isBinary(repo, 'photo.dat', { binaryExts: ['.dat'] });
      expect(configured.isOk()).toBe(true);
      if (configured.isErr()) return;
      expect(configured.value).toEqual({ binary: true, reason: 'ext' });
      const unconfigured = await isBinary(repo, 'photo.dat');
      expect(unconfigured.isOk()).toBe(true);
      if (unconfigured.isErr()) return;
      // No attrs, no NUL, no ext config: honestly text.
      expect(unconfigured.value).toEqual({ binary: false, reason: 'text' });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails unreadable files as INTERNAL', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'real.txt'), 'tracked\n');
      await commitAll(repo, 'base');
      await mkdir(join(repo, 'adir'));
      const result = await isBinary(repo, 'adir');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('INTERNAL');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('classifyFiles (real git)', () => {
  it('classifies', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'a.txt'), 'text\n');
      await writeFile(join(repo, 'b.bin'), Buffer.from([9, 9, 0, 9]));
      await writeFile(join(repo, '.gitattributes'), '*.bin binary\n');
      await writeFile(join(repo, 'c.dat'), 'also text\n');
      await commitAll(repo, 'base');
      const result = await classifyFiles(repo, ['a.txt', 'b.bin', 'c.dat'], {
        binaryExts: ['.dat'],
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      // Input order preserved for stable downstream consumption.
      expect(result.value).toEqual({ text: ['a.txt'], binary: ['b.bin', 'c.dat'] });
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('skips analysis', async () => {
    // The consumer contract: text pipelines take `text`, binary files
    // never enter them — provenance/merge paths take the whole tree.
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'doc.md'), '# docs\n');
      await writeFile(join(repo, 'logo.png'), Buffer.from([137, 80, 78, 71, 0, 1]));
      await commitAll(repo, 'base');
      const result = await classifyFiles(repo, ['doc.md', 'logo.png']);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value.text).toEqual(['doc.md']);
      expect(result.value.binary).toEqual(['logo.png']);
      expect(result.value.text).not.toContain('logo.png');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('still carries', async () => {
    // Binary bytes ride the subtree merge into the child tree intact,
    // then classify as binary there: carried, not analysed.
    const parent = await makeRepo();
    const childSrc = await makeRepo();
    try {
      await writeFile(join(parent, 'keep.txt'), 'parent\n');
      await commitAll(parent, 'parent base');
      const payload = Buffer.from([0, 1, 2, 3, 4, 5, 250, 251]);
      await writeFile(join(childSrc, 'asset.bin'), payload);
      await writeFile(join(childSrc, 'note.txt'), 'child text\n');
      await commitAll(childSrc, 'child base');
      const added = await subtreeAdd(parent, childSrc, 'vendor/child');
      expect(added.isOk()).toBe(true);
      if (added.isErr()) return;
      expect(Buffer.from(await readFile(join(parent, 'vendor/child/asset.bin')))).toEqual(payload);
      const classified = await classifyFiles(parent, [
        'vendor/child/asset.bin',
        'vendor/child/note.txt',
      ]);
      expect(classified.isOk()).toBe(true);
      if (classified.isErr()) return;
      expect(classified.value).toEqual({
        text: ['vendor/child/note.txt'],
        binary: ['vendor/child/asset.bin'],
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
      await rm(childSrc, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('parseCheckAttr (pure)', () => {
  it('parses set/unset/unspecified triples', () => {
    const parsed = parseCheckAttr(
      Buffer.from('a.bin\0binary\0set\0a.bin\0diff\0unset\0'),
      'a.bin',
      ['binary', 'diff']
    );
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    expect(parsed.value).toEqual({ binary: 'set', diff: 'unset' });
  });

  it('rejects truncated and foreign output as INTERNAL', () => {
    for (const bad of [
      Buffer.from('a.bin\0binary\0'),
      Buffer.from('a.bin\0binary\0bogus\0'),
      Buffer.from('other\0binary\0set\0'),
      Buffer.from(''),
    ]) {
      const parsed = parseCheckAttr(bad, 'a.bin', ['binary']);
      expect(parsed.isErr()).toBe(true);
      if (parsed.isOk()) continue;
      expect(parsed.error.code).toBe('INTERNAL');
    }
  });
});

describe('skip persistence (fake DbLike store)', () => {
  async function classifiedDecisions(): Promise<{
    repo: string;
    decisions: SkipDecision[];
    cleanup: () => Promise<void>;
  }> {
    const repo = await makeRepo();
    await writeFile(join(repo, 'a.txt'), 'text\n');
    await writeFile(join(repo, 'b.bin'), Buffer.from([1, 0, 2]));
    await commitAll(repo, 'base');
    const classified = await classifyFiles(repo, ['a.txt', 'b.bin']);
    if (classified.isErr()) throw new Error('fixture failed');
    const decisions: SkipDecision[] = [
      ...classified.value.text.map(path => ({ path, binary: false, reason: 'text' as const })),
      ...classified.value.binary.map(path => ({ path, binary: true, reason: 'magic' as const })),
    ];
    return { repo, decisions, cleanup: () => rm(repo, { recursive: true, force: true }) };
  }

  it('persists skip decisions and reloads them equal', async () => {
    const { repo, decisions, cleanup } = await classifiedDecisions();
    try {
      const { db, rows } = fakeDb();
      const saved = await saveSkipList(db, repo, decisions);
      expect(saved.isOk()).toBe(true);
      expect(rows).toHaveLength(1);
      const loaded = await loadSkipList(db, repo);
      expect(loaded.isOk()).toBe(true);
      if (loaded.isErr()) return;
      expect(loaded.value.repoPath).toBe(repo);
      expect(loaded.value.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(loaded.value.decisions).toEqual(decisions);
    } finally {
      await cleanup();
    }
  }, 30_000);

  it('replaces stale decisions on re-save', async () => {
    const { repo, decisions, cleanup } = await classifiedDecisions();
    try {
      const { db, rows } = fakeDb();
      expect((await saveSkipList(db, repo, decisions)).isOk()).toBe(true);
      expect((await saveSkipList(db, repo, decisions)).isOk()).toBe(true);
      expect(rows).toHaveLength(1);
    } finally {
      await cleanup();
    }
  }, 30_000);

  it('loads empty for an unknown repo', async () => {
    const { db } = fakeDb();
    const loaded = await loadSkipList(db, '/tmp/never-saved');
    expect(loaded.isOk()).toBe(true);
    if (loaded.isErr()) return;
    expect(loaded.value.decisions).toEqual([]);
    expect(loaded.value.headSha).toBeNull();
  }, 30_000);

  it('saves an empty list without resolving HEAD', async () => {
    // No files: nothing to key on, so no rev-parse spawn is needed.
    const seen: string[][] = [];
    const base = scriptedAttr({});
    const { db, rows } = fakeDb();
    const saved = await saveSkipList(
      db,
      '/tmp/repo',
      [],
      {},
      {
        run: async (args, cwd, opts) => {
          seen.push([...args]);
          return base(args, cwd, opts);
        },
      }
    );
    expect(saved.isOk()).toBe(true);
    expect(seen.some(args => args[0] === 'rev-parse')).toBe(false);
    expect(rows).toHaveLength(1);
    const loaded = await loadSkipList(db, '/tmp/repo');
    expect(loaded.isOk()).toBe(true);
    if (loaded.isErr()) return;
    expect(loaded.value).toEqual({ repoPath: '/tmp/repo', headSha: null, decisions: [] });
  });

  it('rejects a blank repoPath without touching the store', async () => {
    const { db, rows } = fakeDb();
    const result = await saveSkipList(db, '   ', []);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
    expect(rows).toHaveLength(0);
  });

  it('maps rev-parse failure to GIT_ERROR', async () => {
    const { db } = fakeDb();
    const decisions: SkipDecision[] = [{ path: 'f.txt', binary: false, reason: 'text' }];
    const result = await saveSkipList(
      db,
      '/tmp/repo',
      decisions,
      {},
      {
        run: scriptedAttr({ revParse: failRun(128, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps a malformed HEAD SHA to INTERNAL', async () => {
    const { db } = fakeDb();
    const decisions: SkipDecision[] = [{ path: 'f.txt', binary: false, reason: 'text' }];
    const result = await saveSkipList(
      db,
      '/tmp/repo',
      decisions,
      {},
      {
        run: scriptedAttr({ revParse: okRun('junk\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps store failures to INTERNAL', async () => {
    const failing: DbLike = {
      exec: () => {},
      query: () => {
        throw new Error('db locked');
      },
      close: () => {},
    };
    const decisions: SkipDecision[] = [{ path: 'f.txt', binary: false, reason: 'text' }];
    const sha = 'a75739818b8db9fa29f02117112255dfc11ead18';
    const runtime = { run: scriptedAttr({ revParse: okRun(`${sha}\n`) }) };
    // DELETE fails first (rev-parse succeeds so the store is reached).
    expect((await saveSkipList(failing, '/tmp/repo', decisions, {}, runtime)).isErr()).toBe(true);
    expect((await loadSkipList(failing, '/tmp/repo')).isErr()).toBe(true);
  });

  it('maps insert failures to INTERNAL', async () => {
    const insertFails: DbLike = {
      exec: () => {},
      query: (sql: string) => {
        if (sql.startsWith('INSERT INTO provenance')) throw new Error('disk full');
        return {
          all: () => [],
          get: () => null,
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
        };
      },
      close: () => {},
    };
    const decisions: SkipDecision[] = [{ path: 'f.txt', binary: false, reason: 'text' }];
    const sha = 'a75739818b8db9fa29f02117112255dfc11ead18';
    const runtime = { run: scriptedAttr({ revParse: okRun(`${sha}\n`) }) };
    const result = await saveSkipList(insertFails, '/tmp/repo', decisions, {}, runtime);
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails misshapen rows as INTERNAL', async () => {
    const badPayloads: unknown[] = [
      '"just a string"',
      '42',
      JSON.stringify({ headSha: null, decisions: [{ path: 42 }] }),
      JSON.stringify({ headSha: null, decisions: [{ path: 'f', binary: 'yes', reason: 'text' }] }),
      JSON.stringify({ headSha: null, decisions: [{ path: 'f', binary: false, reason: 'nope' }] }),
      JSON.stringify({ headSha: null, decisions: [42] }),
    ];
    for (const payload of badPayloads) {
      const { db } = fakeDb([{ repo: '/tmp/r', commit_sha: null, payload: payload as string }]);
      const loaded = await loadSkipList(db, '/tmp/r');
      expect(loaded.isErr()).toBe(true);
      if (loaded.isOk()) continue;
      expect(loaded.error.code).toBe('INTERNAL');
    }
  });

  it('fails non-string payload rows as INTERNAL', async () => {
    const { db, rows } = fakeDb();
    rows.push({ repo: '/tmp/r', commit_sha: null, payload: 42 as unknown as string });
    const loaded = await loadSkipList(db, '/tmp/r');
    expect(loaded.isErr()).toBe(true);
    if (loaded.isOk()) return;
    expect(loaded.error.code).toBe('INTERNAL');
  });

  it('fails corrupt rows as INTERNAL', async () => {
    const { db } = fakeDb([{ repo: '/tmp/r', commit_sha: null, payload: 'not json{{' }]);
    const loaded = await loadSkipList(db, '/tmp/r');
    expect(loaded.isErr()).toBe(true);
    if (loaded.isOk()) return;
    expect(loaded.error.code).toBe('INTERNAL');
  }, 30_000);
});

describe('isBinary validation (no spawn)', () => {
  it('rejects blank repoPath, blank file, and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => isBinary('', 'f.txt', {}, runtime),
      () => isBinary('/tmp/repo', '   ', {}, runtime),
      () => isBinary('/tmp/repo', 'f.txt', { timeoutMs: 0 }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('refuses escaping paths without spawning', async () => {
    const runtime = { run: throwingRun('must not spawn on path refusal') };
    // Platform-absolute outside the root (portable across win32/posix).
    const absOutside = join(tmpdir(), 'stitch-escape.txt');
    for (const bad of ['../evil.txt', absOutside, '.git/hooks/x']) {
      const result = await isBinary('/tmp/repo', bad, {}, runtime);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-binary-plain-'));
    try {
      const result = await isBinary(dir, 'f.txt');
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('isBinary failure arms (scripted)', () => {
  const opts = {};

  it('reads magic bytes through the fs port', async () => {
    const nul = await isBinary('/tmp/repo', 'f.txt', opts, {
      run: scriptedAttr({}),
      fs: scriptedFs(Buffer.from([1, 2, 0, 3])),
    });
    expect(nul.isOk()).toBe(true);
    if (nul.isErr()) return;
    expect(nul.value).toEqual({ binary: true, reason: 'magic' });
    const text = await isBinary('/tmp/repo', 'f.txt', opts, {
      run: scriptedAttr({}),
      fs: scriptedFs(Buffer.from('plain text\n')),
    });
    expect(text.isOk()).toBe(true);
    if (text.isErr()) return;
    expect(text.value).toEqual({ binary: false, reason: 'text' });
  });

  it('maps unreadable files to INTERNAL', async () => {
    const result = await isBinary('/tmp/repo', 'f.txt', opts, {
      run: scriptedAttr({}),
      fs: scriptedFs('throw'),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps attr parse failure to INTERNAL', async () => {
    const result = await isBinary('/tmp/repo', 'f.txt', opts, {
      run: scriptedAttr({ attr: okRun(Buffer.from('bogus\0')) }),
      fs: scriptedFs(Buffer.from('x')),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('fails classify verdicts through unchanged', async () => {
    const result = await classifyFiles('/tmp/repo', ['f.txt'], opts, {
      run: scriptedAttr({ attr: failRun(128, 'fatal: boom') }),
      fs: scriptedFs(Buffer.from('x')),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps check-attr failure to GIT_ERROR', async () => {
    const result = await isBinary('/tmp/repo', 'f.txt', opts, {
      run: scriptedAttr({ attr: failRun(128, 'fatal: bad default revision') }),
    });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('treats a throwing runner as INTERNAL', async () => {
    const result = await isBinary('/tmp/repo', 'f.txt', opts, { run: throwingRun('spawn EACCES') });
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await isBinary(
      '/tmp/repo',
      'f.txt',
      { timeoutMs: 50 },
      {
        run: scriptedAttr({
          revParse: { exitCode: 124, stdout: Buffer.from(''), stderr: '' },
        }),
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
    expect(DEFAULT_BINARY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_BINARY_TIMEOUT_MS)).toBe(true);
  });
});

/** Scripted check-attr: rev-parse ok, attr triples configurable. */
function scriptedAttr(overrides: Partial<Record<string, BinaryRunResult>>): BinaryRunner {
  const table: Record<string, BinaryRunResult> = {
    revParse: okRun('/tmp/repo/.git\n'),
    attr: okRun(
      attrTriples('f.txt', [
        ['binary', 'unspecified'],
        ['diff', 'unspecified'],
      ])
    ),
    ...overrides,
  };
  return async args => {
    const key =
      args[0] === 'rev-parse' ? 'revParse' : args[0] === 'check-attr' ? 'attr' : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  };
}

/** Scripted file content: fixed bytes or a throwing read. */
function scriptedFs(content: Buffer | 'throw'): BinaryFs {
  return {
    readPrefix: async () => {
      if (content === 'throw') throw new Error('EISDIR: illegal operation on a directory');
      return content;
    },
  };
}

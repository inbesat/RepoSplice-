// Commit with co-author trailers (P-077): full suite. Real git proves the
// round-trip (SHA return, trailer bytes, dedupe, injection stripping,
// dirty-refusal shapes); scripted runners prove every failure arm; pure
// unit tests prove message building byte-for-byte.
//
// Timeout note (P-075 precedent): real-git tests carry an explicit 30s
// budget — the core project resolves vitest's 5s default (the root 30s
// does not inherit into defineProject). Scripted/pure tests keep the
// strict default as a canary.

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  commitWithTrailers,
  buildCommitMessage,
  exitCodeOf,
  DEFAULT_COMMIT_TIMEOUT_MS,
  type CoAuthor,
  type CommitRunner,
  type CommitRunResult,
} from './commit.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

/** Hermetic fixture repo (P-072 precedent: local identity + lf). */
async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'stitch-commit-'));
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@stitch.dev']);
  await git(repo, ['config', 'user.name', 'stitch-test']);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  return repo;
}

async function bodyOf(repo: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%B', sha], { cwd: repo });
  // %B appends its own trailing newline beyond the message bytes.
  return stdout.replace(/\n$/, '');
}

const ALICE: CoAuthor = { name: 'Alice A', email: 'alice@example.com' };
const BOB: CoAuthor = { name: 'Bob B', email: 'bob@example.com' };

// ─── Scripted seams ────────────────────────────────────────────────────

function okRun(stdout: string | Buffer = ''): CommitRunResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? Buffer.from(stdout) : stdout,
    stderr: '',
  };
}

function failRun(exitCode: number, stderr: string): CommitRunResult {
  return { exitCode, stdout: Buffer.from(''), stderr };
}

const SHA = 'e028cd1d298874956814f59dfd2948b61d15b7d2';
const STATUS_STAGED_F = Buffer.from('M  f.txt\0');

/** Happy path: repo ok, one staged file, add/commit/rev-parse ok. */
function happyRun(overrides: Partial<Record<string, CommitRunResult>> = {}): CommitRunner {
  const table: Record<string, CommitRunResult> = {
    'rev-parse': okRun('/tmp/repo/.git\n'),
    status: okRun(STATUS_STAGED_F),
    add: okRun(''),
    commit: okRun('[main e028cd1] feat: x\n'),
    'rev-parse-head': okRun(`${SHA}\n`),
    ...overrides,
  };
  return async args => {
    const key = args[0] === 'rev-parse' && args[1] === 'HEAD' ? 'rev-parse-head' : String(args[0]);
    const hit = table[key];
    if (hit === undefined) throw new Error(`unexpected git call: ${args.join(' ')}`);
    return hit;
  };
}

function throwingRun(message: string): CommitRunner {
  return async () => {
    throw new Error(message);
  };
}

describe('commitWithTrailers (real git)', () => {
  it('commits shas', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      const result = await commitWithTrailers(repo, 'feat: add f', [ALICE], {
        files: ['f.txt'],
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(result.value).toMatch(/^[0-9a-f]{40}$/);
      expect(result.value).toBe(await git(repo, ['rev-parse', 'HEAD']));
      expect(await git(repo, ['log', '-1', '--format=%s'])).toBe('feat: add f');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('appends trailers', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      const result = await commitWithTrailers(repo, 'feat: add f\n\nBody here.', [ALICE, BOB], {
        files: ['f.txt'],
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const body = await bodyOf(repo, result.value);
      expect(body).toBe(
        'feat: add f\n\nBody here.\n\nCo-Authored-By: Alice A <alice@example.com>\nCo-Authored-By: Bob B <bob@example.com>\n'
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('dedupes authors', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      const dupes: CoAuthor[] = [
        ALICE,
        { name: 'Alice A', email: 'ALICE@EXAMPLE.COM' },
        BOB,
        { name: 'Alice A', email: 'alice@example.com' },
      ];
      const result = await commitWithTrailers(repo, 'feat: add f', dupes, { files: ['f.txt'] });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const body = await bodyOf(repo, result.value);
      expect(body).toBe(
        'feat: add f\n\nCo-Authored-By: Alice A <alice@example.com>\nCo-Authored-By: Bob B <bob@example.com>\n'
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects injection', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      // Newline in the name flattens to one harmless line; a newline in
      // the mailbox is never legitimate and refuses instead.
      const flat: CoAuthor = {
        name: 'Evil\nCo-Authored-By: mallory@evil',
        email: 'evil@example.com',
      };
      const result = await commitWithTrailers(repo, 'feat: add f', [flat], { files: ['f.txt'] });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const body = await bodyOf(repo, result.value);
      const trailerLines = body.split('\n').filter(line => line.startsWith('Co-Authored-By:'));
      expect(trailerLines).toHaveLength(1);
      expect(trailerLines[0]).toBe(
        'Co-Authored-By: Evil Co-Authored-By: mallory@evil <evil@example.com>'
      );
      const mailbreak: CoAuthor = { name: 'Evil', email: 'evil@example.com\r\nBcc: m@evil' };
      const refused = await commitWithTrailers(repo, 'feat: again', [mailbreak], {
        files: ['f.txt'],
      });
      expect(refused.isErr()).toBe(true);
      if (refused.isOk()) return;
      expect(refused.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses malformed authors without committing', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      const before = await git(repo, ['rev-parse', 'HEAD']).catch(() => 'none');
      for (const bad of [
        [{ name: '', email: 'a@example.com' }],
        [{ name: 'No Email', email: '' }],
        [{ name: 'Spaces', email: 'not an email' }],
        [{ name: 'No At', email: 'nodomain' }],
      ] as CoAuthor[][]) {
        const result = await commitWithTrailers(repo, 'feat: add f', bad, { files: ['f.txt'] });
        expect(result.isErr()).toBe(true);
        if (result.isOk()) continue;
        expect(result.error.code).toBe('CONFIG_ERROR');
      }
      // Nothing was committed by the refused attempts (repo still unborn).
      expect(await git(repo, ['rev-parse', 'HEAD']).catch(() => 'none')).toBe(before);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses dirty', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      await writeFile(join(repo, 'g.txt'), 'tracked\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'base']);
      // Unstaged modification of a NON-intended file refuses, even while
      // the intended file stages fine.
      await writeFile(join(repo, 'f.txt'), 'intended change\n');
      await writeFile(join(repo, 'g.txt'), 'stray change\n');
      const unstaged = await commitWithTrailers(repo, 'feat: x', [ALICE], { files: ['f.txt'] });
      expect(unstaged.isErr()).toBe(true);
      if (unstaged.isOk()) return;
      expect(unstaged.error.code).toBe('GIT_ERROR');
      if (unstaged.error.code === 'GIT_ERROR') {
        expect(unstaged.error.message).toContain('g.txt');
        expect(unstaged.error.message).not.toContain('f.txt');
      }
      // Untracked stray alongside an otherwise committable intent refuses.
      await git(repo, ['checkout', '-q', '--', 'g.txt']);
      await writeFile(join(repo, 'stray.txt'), 'stray\n');
      const untracked = await commitWithTrailers(repo, 'feat: x', [ALICE], { files: ['f.txt'] });
      expect(untracked.isErr()).toBe(true);
      if (untracked.isOk()) return;
      expect(untracked.error.code).toBe('GIT_ERROR');
      if (untracked.error.code === 'GIT_ERROR') {
        expect(untracked.error.message).toContain('stray.txt');
      }
      // Only the base commit exists: refusals committed nothing.
      expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses staged extras beyond the intended set', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      await writeFile(join(repo, 'extra.txt'), 'not intended\n');
      await git(repo, ['add', '-A']);
      await git(repo, ['commit', '-qm', 'base']);
      await writeFile(join(repo, 'f.txt'), 'more work\n');
      await writeFile(join(repo, 'sneaky.txt'), 'sneaky\n');
      await git(repo, ['add', '--', 'f.txt', 'sneaky.txt']);
      const result = await commitWithTrailers(repo, 'feat: x', [ALICE], { files: ['f.txt'] });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      if (result.error.code === 'GIT_ERROR') {
        expect(result.error.message).toContain('sneaky.txt');
      }
      expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits the index as-is when files are omitted', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      await git(repo, ['add', '--', 'f.txt']);
      const result = await commitWithTrailers(repo, 'feat: from index', [ALICE]);
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      expect(await git(repo, ['log', '-1', '--format=%s'])).toBe('feat: from index');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses an empty index with nothing staged', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const result = await commitWithTrailers(repo, 'feat: nothing', [ALICE]);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('GIT_ERROR');
      expect(await git(repo, ['rev-list', '--count', 'HEAD'])).toBe('1');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('maps an unmatchable files entry to CONFIG_ERROR', async () => {
    const repo = await makeRepo();
    try {
      await git(repo, ['commit', '--allow-empty', '-qm', 'base']);
      const result = await commitWithTrailers(repo, 'feat: x', [ALICE], { files: ['nope.txt'] });
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('files');
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('normalizes CRLF to LF end to end', async () => {
    const repo = await makeRepo();
    try {
      await writeFile(join(repo, 'f.txt'), 'work\n');
      const crlf: CoAuthor = { name: 'Carriage\r\nReturn', email: 'crlf@example.com' };
      const result = await commitWithTrailers(repo, 'feat: add f\r\n\r\nBody\r\nline.', [crlf], {
        files: ['f.txt'],
      });
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const body = await bodyOf(repo, result.value);
      expect(body).not.toContain('\r');
      expect(body).toContain('Co-Authored-By: Carriage Return <crlf@example.com>');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('buildCommitMessage (pure)', () => {
  it('builds exact bytes: subject, body, blank, trailers, newline', () => {
    const result = buildCommitMessage('feat: add f\n\nBody here.', [ALICE, BOB]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe(
      'feat: add f\n\nBody here.\n\nCo-Authored-By: Alice A <alice@example.com>\nCo-Authored-By: Bob B <bob@example.com>\n'
    );
  });

  it('handles a subject-only message', () => {
    const result = buildCommitMessage('fix: one-liner', [ALICE]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('fix: one-liner\n\nCo-Authored-By: Alice A <alice@example.com>\n');
  });

  it('collapses trailing blank lines before trailers', () => {
    const result = buildCommitMessage('feat: x\n\n\n\n', [ALICE]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe('feat: x\n\nCo-Authored-By: Alice A <alice@example.com>\n');
  });

  it('is deterministic for the same inputs', () => {
    const first = buildCommitMessage('feat: x', [BOB, ALICE]);
    const second = buildCommitMessage('feat: x', [BOB, ALICE]);
    expect(first.isOk() && second.isOk()).toBe(true);
    if (first.isErr() || second.isErr()) return;
    expect(first.value).toBe(second.value);
  });

  it('preserves input order (lineage order, not sorted)', () => {
    const result = buildCommitMessage('feat: x', [BOB, ALICE]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const lines = result.value.split('\n').filter(line => line.startsWith('Co-Authored-By:'));
    expect(lines).toEqual([
      'Co-Authored-By: Bob B <bob@example.com>',
      'Co-Authored-By: Alice A <alice@example.com>',
    ]);
  });

  it('strips newline injection to a single line', () => {
    // A newline in the name flattens to one harmless line (names may hold
    // spaces); a newline in the mailbox is never legitimate and refuses.
    const evil: CoAuthor = {
      name: 'Evil\nCo-Authored-By: mallory@evil',
      email: 'evil@example.com',
    };
    const result = buildCommitMessage('feat: x', [evil]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).not.toContain('\r');
    const trailers = result.value.split('\n').filter(line => line.startsWith('Co-Authored-By:'));
    expect(trailers).toEqual([
      'Co-Authored-By: Evil Co-Authored-By: mallory@evil <evil@example.com>',
    ]);
    const mailbreak = buildCommitMessage('feat: x', [
      { name: 'Evil', email: 'evil@example.com\r\nBcc: mallory@evil' },
    ]);
    expect(mailbreak.isErr()).toBe(true);
    if (mailbreak.isOk()) return;
    expect(mailbreak.error.code).toBe('CONFIG_ERROR');
  });

  it('rejects blank messages and malformed authors', () => {
    for (const [message, authors] of [
      ['', [ALICE]],
      ['   ', [ALICE]],
      ['feat: x', [{ name: '', email: 'a@example.com' }]],
      ['feat: x', [{ name: 'A', email: '' }]],
      ['feat: x', [{ name: 'A', email: 'not an email' }]],
      ['feat: x', [{ name: 'A', email: 'nodomain' }]],
    ] as Array<[string, CoAuthor[]]>) {
      const result = buildCommitMessage(message, authors);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('dedupes by name plus lowercased email, keeping the first', () => {
    const result = buildCommitMessage('feat: x', [
      ALICE,
      { name: 'Alice A', email: 'ALICE@EXAMPLE.COM' },
      { name: 'Other Name', email: 'alice@example.com' },
    ]);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    // Same mailbox twice (second wins the dedupe race and is dropped), plus
    // a distinct name on the same mailbox stays (different attribution).
    expect(result.value).toBe(
      'feat: x\n\nCo-Authored-By: Alice A <alice@example.com>\nCo-Authored-By: Other Name <alice@example.com>\n'
    );
  });
});

describe('commitWithTrailers validation (no spawn)', () => {
  it('rejects blank repoPath, blank message, and bad timeouts', async () => {
    const run = throwingRun('must not spawn on validation failure');
    const runtime = { run };
    for (const call of [
      () => commitWithTrailers('', 'feat: x', [ALICE], {}, runtime),
      () => commitWithTrailers('/tmp/repo', '   ', [ALICE], {}, runtime),
      () => commitWithTrailers('/tmp/repo', 'feat: x', [ALICE], { timeoutMs: 0 }, runtime),
      () => commitWithTrailers('/tmp/repo', 'feat: x', [ALICE], { files: ['  '] }, runtime),
    ]) {
      const result = await call();
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('CONFIG_ERROR');
    }
  });

  it('rejects a non-repo directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stitch-commit-plain-'));
    try {
      const result = await commitWithTrailers(dir, 'feat: x', [ALICE]);
      expect(result.isErr()).toBe(true);
      if (result.isOk()) return;
      expect(result.error.code).toBe('CONFIG_ERROR');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('commitWithTrailers failure arms (scripted)', () => {
  const message = 'feat: add f';
  const authors = [ALICE];

  it('maps rev-parse failure to CONFIG_ERROR (not a repo)', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ 'rev-parse': failRun(128, 'fatal: not a git repository') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('CONFIG_ERROR');
  });

  it('maps status failure to GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ status: failRun(128, 'fatal: bad default revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps the timeout sentinel to a GIT_ERROR mentioning the timeout', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { timeoutMs: 50 },
      { run: happyRun({ status: { exitCode: 124, stdout: Buffer.from(''), stderr: '' } }) }
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
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: throwingRun('spawn EACCES'),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('refuses an unexpected staged set as GIT_ERROR with paths', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['f.txt'] },
      {
        run: happyRun({ status: okRun(Buffer.from('M  f.txt\0M  sneaky.txt\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('sneaky.txt');
    }
  });

  it('refuses a missing staged file as GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['f.txt'] },
      {
        run: happyRun({ status: okRun(Buffer.from('M  other.txt\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('parses rename entries by their new path', async () => {
    // `R  new` + NUL + `old`: the committed tree carries the new name.
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['new.txt'] },
      {
        run: happyRun({
          status: okRun(Buffer.from('R  new.txt\0old.txt\0')),
          commit: okRun('[main abc] feat\n'),
        }),
      }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toBe(SHA);
  });

  it('refuses unmerged entries as GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['f.txt'] },
      {
        run: happyRun({ status: okRun(Buffer.from('UU f.txt\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
    if (result.error.code === 'GIT_ERROR') {
      expect(result.error.message).toContain('unmerged');
    }
  });

  it('refuses a truncated rename as INTERNAL', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['new.txt'] },
      {
        run: happyRun({ status: okRun(Buffer.from('R  new.txt\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('rejects malformed porcelain as INTERNAL', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ status: okRun(Buffer.from('bogus\0')) }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps add failure to GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['f.txt'] },
      {
        run: happyRun({ add: failRun(128, 'fatal: boom') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('maps commit failure to GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ commit: failRun(1, 'nothing to commit') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('refuses drift appearing during staging', async () => {
    // Pre-add status is clean; the post-add re-read finds stray state
    // (a file changed between add and verify).
    for (const dirty of ['M  f.txt\0 M g.txt\0', 'M  f.txt\0?? fresh.txt\0']) {
      let statuses = 0;
      const base = happyRun();
      const runtime: { run: CommitRunner } = {
        run: async (args, cwd, opts) => {
          if (args[0] === 'status') {
            statuses += 1;
            if (statuses > 1) return okRun(Buffer.from(dirty));
          }
          return base(args, cwd, opts);
        },
      };
      const result = await commitWithTrailers(
        '/tmp/repo',
        message,
        authors,
        { files: ['f.txt'] },
        runtime
      );
      expect(result.isErr()).toBe(true);
      if (result.isOk()) continue;
      expect(result.error.code).toBe('GIT_ERROR');
    }
  });

  it('maps post-add status failure to GIT_ERROR', async () => {
    let statuses = 0;
    const base = happyRun();
    const runtime: { run: CommitRunner } = {
      run: async (args, cwd, opts) => {
        if (args[0] === 'status') {
          statuses += 1;
          if (statuses > 1) return failRun(128, 'fatal: boom');
        }
        return base(args, cwd, opts);
      },
    };
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      { files: ['f.txt'] },
      runtime
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });

  it('fails a malformed SHA as INTERNAL', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ 'rev-parse-head': okRun('not-a-sha\n') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('INTERNAL');
  });

  it('maps rev-parse HEAD failure to GIT_ERROR', async () => {
    const result = await commitWithTrailers(
      '/tmp/repo',
      message,
      authors,
      {},
      {
        run: happyRun({ 'rev-parse-head': failRun(128, 'fatal: bad default revision') }),
      }
    );
    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.code).toBe('GIT_ERROR');
  });
});

describe('module constants', () => {
  it('exposes the default timeout', () => {
    expect(DEFAULT_COMMIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_COMMIT_TIMEOUT_MS)).toBe(true);
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

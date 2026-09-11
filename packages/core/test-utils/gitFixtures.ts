import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Shared git fixtures (P-087) for hermetic, offline-safe suites across the
 * Git Core epic (P-069–P-087): deterministic temp repos (fixed identity,
 * LF line endings, `main` branch) with resilient cleanup.
 *
 * Hermeticity: everything is local (`file://` clones, no network), every
 * builder takes an explicit prefix so parallel workers never collide, and
 * `disposeRepo` retries against Windows file-lock races.
 *
 * Throwing by design (P-063 precedent): git failures reject — that IS the
 * signal in test context (vitest fails the test, or the suite catches for
 * negative assertions). Production code paths are unaffected; production
 * APIs keep returning `Result` and never throw.
 */

const execFileAsync = promisify(execFile);

/** Fixed fixture identity (stable authorship across suites). */
export const FIXTURE_IDENTITY = { name: 'stitch-test', email: 'test@stitch.dev' } as const;

/** Relative path → content (string or raw bytes for binary fixtures). */
export type SeedFiles = Record<string, string | Buffer>;

/** Run git in a repo; resolves trimmed stdout, rejects on failure. */
export async function git(repo: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd: repo });
  return stdout.trim();
}

export interface MakeTempRepoOpts {
  /** Initial branch. Default: `main`. */
  branch?: string;
  /** Files to seed + commit immediately. Absent: no commits (unborn). */
  seed?: SeedFiles;
  /** Seed commit message. Default: `seed`. */
  message?: string;
  /** Identity override. Default: FIXTURE_IDENTITY. */
  identity?: { name: string; email: string };
  /** Bare repo (push targets). Default: false. */
  bare?: boolean;
}

/**
 * Hermetic temp repo: init, local identity, LF endings. Unborn unless
 * `seed` is given. Resolves the repo path.
 */
export async function makeTempRepo(prefix: string, opts: MakeTempRepoOpts = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  if (opts.bare === true) {
    await git(dir, ['init', '-q', '--bare']);
    return dir;
  }
  await git(dir, ['init', '-q', '-b', opts.branch ?? 'main']);
  const identity = opts.identity ?? FIXTURE_IDENTITY;
  await git(dir, ['config', 'user.email', identity.email]);
  await git(dir, ['config', 'user.name', identity.name]);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  await git(dir, ['config', 'core.eol', 'lf']);
  if (opts.seed !== undefined) {
    await writeSeedFiles(dir, opts.seed);
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-qm', opts.message ?? 'seed']);
  }
  return dir;
}

/** Write seed files, creating parent dirs (nested fixtures welcome). */
export async function writeSeedFiles(repo: string, files: SeedFiles): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}

/**
 * Write files, stage everything, commit. Resolves the new HEAD SHA.
 * At least one file must change vs HEAD (no allow-empty magic).
 */
export async function commitFiles(
  repo: string,
  files: SeedFiles,
  message: string
): Promise<string> {
  await writeSeedFiles(repo, files);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', message]);
  return headSha(repo);
}

/** Current HEAD SHA (rejects on unborn HEAD — assert it in tests). */
export async function headSha(repo: string): Promise<string> {
  return git(repo, ['rev-parse', 'HEAD']);
}

/** Resilient recursive removal (retries Windows lock races). */
export async function disposeRepo(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

/** Bare scratch dir (multi-repo scenarios own their layout). */
export async function makeScratchDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Two-branch divergence on one file (merge/cherry/rebase conflicts). */
export interface ConflictPair {
  /** Scratch root owning the repo (dispose this). */
  dir: string;
  /** The diverged repo, currently on `main`. */
  repo: string;
  /** Pre-divergence SHA (clean rollback target). */
  base: string;
}

/**
 * Repo whose `main` and `side` both changed `target` incompatibly:
 * merging `side` into `main` conflicts. Main holds `mainContent`,
 * side holds `sideContent`.
 */
export async function makeConflictPair(
  prefix: string,
  target: string,
  mainContent: string,
  sideContent: string
): Promise<ConflictPair> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', FIXTURE_IDENTITY.email]);
  await git(repo, ['config', 'user.name', FIXTURE_IDENTITY.name]);
  await git(repo, ['config', 'core.autocrlf', 'false']);
  await git(repo, ['config', 'core.eol', 'lf']);
  await writeSeedFiles(repo, { [target]: 'base\n' });
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'base']);
  const base = await headSha(repo);
  await git(repo, ['checkout', '-qb', 'side']);
  await writeSeedFiles(repo, { [target]: sideContent });
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'side']);
  await git(repo, ['checkout', '-q', 'main']);
  await writeSeedFiles(repo, { [target]: mainContent });
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-qm', 'main']);
  return { dir, repo, base };
}

/** `file:///` URL for a local dir (epic precedent: triple slash). */
export function toFileUrl(dir: string): string {
  return `file:///${dir.replace(/\\/g, '/')}`;
}

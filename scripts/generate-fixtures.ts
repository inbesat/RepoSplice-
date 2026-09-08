import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ok, err, type Result } from 'neverthrow';

/**
 * Deterministic fixture-repo generator (P-064) for integration testing
 * (P-238/P-254): Git Core (P-087), Deps (P-117), License (P-130), E2E (P-255).
 *
 * Config-driven: callers pass a fixture manifest (`FixtureSpec[]`) describing
 * commits (messages, fixed file bytes, lightweight tags). Every repo is
 * reproducible: fixed author/committer identity + dates, `core.autocrlf`
 * off, `core.fileMode` off, `safe.directory=*`, explicit `-b main` — so
 * commit SHAs, trees, and tags are byte-identical across runs (P-282),
 * ready for snapshot comparison (P-260).
 *
 * Error model: `Result` with a script-local `FixtureError` (never throws).
 * The codes mirror the `StitchError` `{code, message}` shape but stay local
 * on purpose: this is unshipped dev tooling (`scripts/` is in no package's
 * `files`), and importing the core barrel here would drag the production
 * dependency graph (dockerode, tree-sitter natives) into a script. The
 * production `StitchError` contract keeps exactly its 14 codes.
 *
 * Run directly: `bun scripts/generate-fixtures.ts [--root <dir>] [--clean]`.
 * `--clean` wipes the cache root first; cleaning outside the OS temp dir is
 * refused (P-081/P-085 safety).
 */

/** File bytes: fixed text or fixed base64 (binary payloads, P-082). */
export type FileContent = { text: string } | { base64: string };

/** One file at a repo-relative path. */
export interface FixtureFile {
  path: string;
  content: FileContent;
}

/** One commit: files written, then committed with a fixed message. */
export interface FixtureCommit {
  message: string;
  files: FixtureFile[];
  /** Lightweight tag placed on the commit (no tagger metadata by design). */
  tag?: string;
  /** Allow committing when nothing is staged (empty-repo shape). */
  allowEmpty?: boolean;
}

/** One fixture repo: ordered commits applied onto a fresh `git init`. */
export interface FixtureSpec {
  name: string;
  commits: FixtureCommit[];
}

/** Generation options: cache root + whether to wipe it first. */
export interface GenerateOptions {
  root: string;
  clean?: boolean;
}

export type FixtureErrorCode = 'GIT_FAILED' | 'FS_FAILED' | 'UNSAFE_CLEAN';

/** Script-local error (see header: mirrors StitchError shape, stays local). */
export interface FixtureError {
  code: FixtureErrorCode;
  message: string;
  command?: string;
}

const AUTHOR_NAME = 'stitch-fixtures';
const AUTHOR_EMAIL = 'fixtures@repo-stitcher.local';
const COMMIT_DATE = '2020-01-01T00:00:00+00:00';

/** Per-command `-c` flags: hermetic identity + byte-stable objects. */
const GIT_CONFIG_FLAGS: readonly string[] = [
  '-c',
  `user.name=${AUTHOR_NAME}`,
  '-c',
  `user.email=${AUTHOR_EMAIL}`,
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'core.fileMode=false',
  '-c',
  'safe.directory=*',
];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: COMMIT_DATE,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_DATE: COMMIT_DATE,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runGit(cwd: string, args: readonly string[]): Promise<Result<string, FixtureError>> {
  return new Promise(resolvePromise => {
    execFile(
      'git',
      [...GIT_CONFIG_FLAGS, ...args],
      { cwd, env: gitEnv() },
      (error, stdout, stderr) => {
        if (error !== null) {
          resolvePromise(
            err({
              code: 'GIT_FAILED',
              message: stderr.trim() === '' ? error.message : stderr.trim(),
              command: `git ${args.join(' ')}`,
            })
          );
        } else {
          resolvePromise(ok(stdout.trim()));
        }
      }
    );
  });
}

async function writeFixtureFile(
  dir: string,
  file: FixtureFile
): Promise<Result<void, FixtureError>> {
  const target = join(dir, file.path);
  try {
    await mkdir(dirname(target), { recursive: true });
    if ('text' in file.content) {
      await writeFile(target, file.content.text, 'utf8');
    } else {
      await writeFile(target, Buffer.from(file.content.base64, 'base64'));
    }
    return ok(undefined);
  } catch (error) {
    return err({ code: 'FS_FAILED', message: `cannot write ${target}: ${messageOf(error)}` });
  }
}

async function buildRepo(dir: string, spec: FixtureSpec): Promise<Result<void, FixtureError>> {
  if (existsSync(dir)) {
    return err({
      code: 'FS_FAILED',
      message: `${dir} already exists (pass clean:true to regenerate deterministically)`,
    });
  }
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    return err({ code: 'FS_FAILED', message: `cannot create ${dir}: ${messageOf(error)}` });
  }
  const initialized = await runGit(dir, ['init', '-b', 'main']);
  if (initialized.isErr()) return err(initialized.error);
  for (const commit of spec.commits) {
    for (const file of commit.files) {
      const written = await writeFixtureFile(dir, file);
      if (written.isErr()) return written;
    }
    const staged = await runGit(dir, ['add', '-A']);
    if (staged.isErr()) return err(staged.error);
    const commitArgs =
      commit.allowEmpty === true && commit.files.length === 0
        ? ['commit', '--allow-empty', '-m', commit.message]
        : ['commit', '-m', commit.message];
    const committed = await runGit(dir, commitArgs);
    if (committed.isErr()) return err(committed.error);
    if (commit.tag !== undefined) {
      const tagged = await runGit(dir, ['tag', commit.tag]);
      if (tagged.isErr()) return err(tagged.error);
    }
  }
  return ok(undefined);
}

/**
 * Generate one repo per spec under `opts.root`, returning the repo dirs in
 * spec order. With `clean:true` the root is wiped first (same safety guard
 * as `cleanFixtures`). Without it, an existing spec dir is an error — never
 * silently mixed, so reruns stay deterministic.
 */
export async function generateFixtures(
  specs: readonly FixtureSpec[],
  opts: GenerateOptions
): Promise<Result<string[], FixtureError>> {
  const root = resolve(opts.root);
  if (opts.clean === true) {
    const cleaned = await cleanFixtures(root);
    if (cleaned.isErr()) return err(cleaned.error);
  }
  const dirs: string[] = [];
  for (const spec of specs) {
    const dir = join(root, spec.name);
    const built = await buildRepo(dir, spec);
    if (built.isErr()) return err(built.error);
    dirs.push(dir);
  }
  return ok(dirs);
}

/**
 * Remove a fixture cache root. Refuses anything outside the OS temp dir
 * (`UNSAFE_CLEAN`, nothing deleted, no throw) — `--clean` can never escape
 * into the repo, home, or `/`.
 */
export async function cleanFixtures(root: string): Promise<Result<void, FixtureError>> {
  const resolved = resolve(root);
  const rel = relative(resolve(tmpdir()), resolved);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return err({
      code: 'UNSAFE_CLEAN',
      message: `refusing to clean outside the temp dir: ${resolved}`,
    });
  }
  try {
    await rm(resolved, { recursive: true, force: true });
    return ok(undefined);
  } catch (error) {
    return err({ code: 'FS_FAILED', message: `cannot clean ${resolved}: ${messageOf(error)}` });
  }
}

const MIT_LICENSE = `MIT License

Copyright (c) 2020 stitch-fixtures

Permission is hereby granted, free of charge, to any person obtaining a copy.
`;

/** Default manifest for direct CLI runs (tests bring their own specs). */
export const DEFAULT_SPECS: readonly FixtureSpec[] = [
  {
    name: 'demo-npm',
    commits: [
      {
        message: 'initial',
        tag: 'v0.1.0',
        files: [
          {
            path: 'package.json',
            content: { text: '{\n  "name": "demo-npm",\n  "version": "0.1.0"\n}\n' },
          },
          { path: 'LICENSE', content: { text: MIT_LICENSE } },
        ],
      },
    ],
  },
];

function parseArgs(argv: readonly string[]): { root: string; clean: boolean; help: boolean } {
  let root = join(tmpdir(), 'stitch-fixtures');
  let clean = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--clean') {
      clean = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--root') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        root = next;
        i++;
      }
    } else if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (value !== '') root = value;
    }
  }
  return { root, clean, help };
}

async function main(argv: readonly string[]): Promise<number> {
  const { root, clean, help } = parseArgs(argv);
  if (help) {
    console.log('usage: bun scripts/generate-fixtures.ts [--root <dir>] [--clean]');
    return 0;
  }
  const result = await generateFixtures(DEFAULT_SPECS, { root, clean });
  if (result.isErr()) {
    console.error(`generate-fixtures: ${result.error.code}: ${result.error.message}`);
    return 1;
  }
  for (const dir of result.value) console.log(dir);
  return 0;
}

if (import.meta.main === true) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}

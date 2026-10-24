// P-253 — the shared unit-test helpers for `packages/core`.
//
// Why here and not a root `test-utils` package: the phase's own handoff note
// says keep helpers in `src/test` so each package owns its mocks and can
// diverge when needed (P-253, Handoff Notes).
//
// The no-throw guardrail applies to PUBLIC APIs (anything the core barrel
// re-exports). These helpers are deliberately NOT re-exported from
// `src/index.ts`: they are test-only utilities, and a broken environment (git
// missing, tmpdir unwritable) surfaces as a thrown error that vitest reports
// as a failing test. No helper throws on a normal path.
//
// Everything here is deterministic: no wall-clock reads, no unseeded randomness, no
// network, and every temp path is removed by the caller or by `withTempDir`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createMockProvider, type MockConfig, type MockProvider } from '../ai/mock.js';
import { countTokens, estimateCost } from '../ai/cost.js';
import type { ChatMessage, ModelSpec, TokenUsage } from '../ai/types.js';
import { Bus } from '../events/bus.js';

/** The timestamp every deterministic helper uses (no wall clock in tests). */
export const FROZEN_NOW = '2026-01-01T00:00:00.000Z';

/** Create a temp directory under the OS tmpdir and return its path. */
export function tempDir(prefix = 'stitch-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Run `fn` against a fresh temp directory and remove it afterwards.
 *
 * Removal happens in a `finally`, so a failing assertion still cleans up.
 */
export function withTempDir<T>(
  fn: (root: string) => T | Promise<T>,
  prefix = 'stitch-test-'
): T | Promise<T> {
  const root = tempDir(prefix);
  const dispose = (): void => {
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const outcome = fn(root);
    if (outcome instanceof Promise) {
      return outcome.finally(dispose) as T | Promise<T>;
    }
    dispose();
    return outcome;
  } catch (cause) {
    dispose();
    throw cause;
  }
}

/** The absolute path of a file inside a temp root (parents are created). */
export function writeFixtureFile(root: string, relative: string, content: string): string {
  const absolute = resolve(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return absolute;
}

/** Options for {@link mkFixtureRepo}. */
export interface FixtureRepoOptions {
  /** Commit subject (default `fixture`). */
  readonly message?: string;
  /** Branch name to create and check out (default `main`). */
  readonly branch?: string;
}

/** A committed git fixture repo plus the way to remove it. */
export interface FixtureRepo {
  readonly root: string;
  /** `git -C <root> <args>` with the fixture's own environment. */
  git(args: readonly string[]): string;
  readonly dispose: () => void;
}

/**
 * Create a real, committed git repository holding `files`.
 *
 * The P-188/P-069 fixture pattern: git is driven directly (no core wrapper for
 * `ls-tree`/`log`), the identity is fixed per repo so commits are reproducible,
 * and the caller disposes it with `withFixtureRepo` or `repo.dispose()`.
 */
export function mkFixtureRepo(
  files: Readonly<Record<string, string>>,
  options: FixtureRepoOptions = {}
): FixtureRepo {
  const root = tempDir('stitch-fixture-');
  const git = (args: readonly string[]): string =>
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'user.name=fixture',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.autocrlf=false',
        ...args,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    );
  git(['init', '-q', '--initial-branch', options.branch ?? 'main']);
  for (const [relative, content] of Object.entries(files)) {
    writeFixtureFile(root, relative, content);
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', options.message ?? 'fixture']);
  return {
    root,
    git,
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Run `fn` against a fixture repo and dispose it afterwards. */
export function withFixtureRepo<T>(
  files: Readonly<Record<string, string>>,
  fn: (repo: FixtureRepo) => T | Promise<T>,
  options: FixtureRepoOptions = {}
): T | Promise<T> {
  const repo = mkFixtureRepo(files, options);
  const dispose = (): void => {
    repo.dispose();
  };
  try {
    const outcome = fn(repo);
    if (outcome instanceof Promise) {
      return outcome.finally(dispose) as T | Promise<T>;
    }
    dispose();
    return outcome;
  } catch (cause) {
    dispose();
    throw cause;
  }
}

/** Every note (`git notes show`) attached to a ref, or undefined when none. */
export function readNotes(root: string, ref = 'HEAD'): string | undefined {
  try {
    return execFileSync('git', ['-C', root, 'notes', 'show', ref], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
}

/**
 * Assert a provenance note carries `needle`.
 *
 * Provenance writes git notes (P-188); this is the one-line way a test says so.
 */
export function expectNotes(root: string, needle: string, ref = 'HEAD'): string {
  const notes = readNotes(root, ref);
  if (notes === undefined) {
    throw new Error(`expected a git note on ${ref} in ${root}, but there is none`);
  }
  if (!notes.includes(needle)) {
    throw new Error(`expected the note on ${ref} to contain ${needle}`);
  }
  return notes;
}

/** The mock provider every AI test should use (P-144, zero network I/O). */
export function mockProvider(config: MockConfig = {}): MockProvider {
  return createMockProvider({ model: 'mock-model', ...config });
}

/**
 * The stand-in for the `openrouter` provider: same script surface, the name and
 * model a test asserting provider routing expects.
 */
export function mockOpenRouter(config: MockConfig = {}): MockProvider {
  return createMockProvider({ name: 'openrouter', model: 'openrouter/auto', ...config });
}

/**
 * A bus instance with a frozen clock (P-241).
 *
 * Each call is a SEPARATE bus on purpose: the shared singleton must never leak
 * state between tests (the module's own guidance).
 */
export function fakeBus(now: string = FROZEN_NOW): Bus {
  return new Bus({ now: () => now });
}

/**
 * Freeze a token count and its cost for `messages` under `model`.
 *
 * Token accounting must be assertable without a provider or a clock, so this
 * pins the heuristic count (P-137) and the price arithmetic in one value.
 */
export function tokenFreeze(
  messages: readonly ChatMessage[],
  model: ModelSpec
): { tokens: number; usage: TokenUsage; cost: { input: number; output: number; total: number } } {
  const tokens = countTokens([...messages]);
  const usage: TokenUsage = { input: tokens, output: 0, total: tokens };
  const cost = estimateCost(model, usage);
  return { tokens, usage, cost };
}

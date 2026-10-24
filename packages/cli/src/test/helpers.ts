// P-253 — the shared unit-test helpers for `packages/cli`.
//
// Kept per package on purpose (the phase's handoff note): the CLI's helpers
// wrap process-level concerns (stdio, env, temp dirs) that core has no business
// knowing about, and importing core's test helpers would mean reaching into
// `core/src/*` internals, which the lane rule forbids.
//
// No helper touches the network, the wall clock or the real home directory.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The timestamp deterministic CLI tests use (no wall clock in tests). */
export const FROZEN_NOW = '2026-01-01T00:00:00.000Z';

/** Create a temp directory under the OS tmpdir and return its path. */
export function tempDir(prefix = 'stitch-cli-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Run `fn` against a fresh temp directory and remove it afterwards. */
export function withTempDir<T>(
  fn: (root: string) => T | Promise<T>,
  prefix = 'stitch-cli-test-'
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

/** Write `content` to a file inside a temp root, creating its parents. */
export function writeFixtureFile(root: string, relative: string, content: string): string {
  const absolute = resolve(root, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
  return absolute;
}

/** What a command wrote while it ran. */
export interface CapturedOutput {
  readonly stdout: string;
  readonly stderr: string;
}

function appendChunk(target: string[], chunk: unknown): void {
  target.push(typeof chunk === 'string' ? chunk : String(chunk));
}

/**
 * Run `fn` with stdout/stderr captured, then restore both.
 *
 * Commands report through `process.stdout.write` / `process.stderr.write`
 * (and the exit code through their return value), so this is how a test reads
 * what a user would have seen without spawning a process.
 */
export async function captureStdio<T>(
  fn: () => T | Promise<T>
): Promise<{ result: T; output: CapturedOutput }> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const stdout = process.stdout as unknown as { write: unknown };
  const stderr = process.stderr as unknown as { write: unknown };
  stdout.write = (chunk: unknown): boolean => {
    appendChunk(outChunks, chunk);
    return true;
  };
  stderr.write = (chunk: unknown): boolean => {
    appendChunk(errChunks, chunk);
    return true;
  };
  try {
    const result = await fn();
    return { result, output: { stdout: outChunks.join(''), stderr: errChunks.join('') } };
  } finally {
    stdout.write = originalOut;
    stderr.write = originalErr;
  }
}

/** Run `fn` with `vars` applied to `process.env`, restoring the old values. */
export async function withEnv<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => T | Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Lockfile regeneration for merged manifests (P-114).
//
// After `merge.ts` produces a `UnifiedManifest`, the child repo C needs
// a lockfile that pins the exact resolved graph for reproducible builds.
// This module shells out to the ecosystem's own lockfile command, captures
// output for provenance (P-116/P-311), and returns a typed `Result`.
//
// Safety contract (P-011):
// - All public APIs return `Result`/`ResultAsync`, never throw.
// - All child_process calls are wrapped with timeout (120s), env
//   passthrough for offline flag, and stdout/stderr capture.
// - Only command strings, exit codes, and stderr reach errors — never
//   file contents beyond lockfile path existence.

import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathExists } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { UnifiedManifest } from './types.js';

export interface LockfileResult {
  ecosystem: 'npm' | 'python' | 'cargo' | 'go';
  lockfilePath: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  createdAt: string;
}

export interface RegenerateLockfileOptions {
  /** When false, set offline env vars so the command fails fast rather than hangs. */
  allowNetwork?: boolean;
  /** Override exec for testing — receives command, args, cwd, env. */
  execImpl?: (
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Override fs check for testing. */
  existsImpl?: (path: string) => Promise<boolean>;
  /** Timeout in ms for the child process. Default 120s. */
  timeoutMs?: number;
}

function inferEcosystem(manifest: UnifiedManifest): 'npm' | 'python' | 'cargo' | 'go' | null {
  if (
    'package' in manifest &&
    'dependencies' in manifest &&
    typeof (manifest as { package?: unknown }).package === 'object'
  ) {
    return 'cargo';
  }
  if ('module' in manifest && 'require' in manifest) {
    return 'go';
  }
  if ('source' in manifest && 'dependencies' in manifest) {
    return 'python';
  }
  // Npm is the fallback — it has dependencies/devDependencies etc. without source/package/module
  if (
    'dependencies' in manifest ||
    'devDependencies' in manifest ||
    'peerDependencies' in manifest
  ) {
    return 'npm';
  }
  // Empty or unknown shape — treat as npm for now
  return 'npm';
}

export interface LockfileCommand {
  ecosystem: 'npm' | 'python' | 'cargo' | 'go';
  command: string;
  args: string[];
  lockfilePath: string;
  fullCommand: string;
}

export function buildLockfileCommand(
  ecosystem: 'npm' | 'python' | 'cargo' | 'go',
  repoPath: string
): LockfileCommand {
  switch (ecosystem) {
    case 'npm': {
      const lockfilePath = join(repoPath, 'bun.lock');
      const command = 'bun';
      const args = ['install', '--frozen-lockfile=false'];
      return {
        ecosystem,
        command,
        args,
        lockfilePath,
        fullCommand: `${command} ${args.join(' ')}`,
      };
    }
    case 'python': {
      // Prefer uv lock (modern) over pip-compile
      const lockfilePath = join(repoPath, 'uv.lock');
      const command = 'uv';
      const args = ['lock'];
      return {
        ecosystem,
        command,
        args,
        lockfilePath,
        fullCommand: `${command} ${args.join(' ')}`,
      };
    }
    case 'cargo': {
      const lockfilePath = join(repoPath, 'Cargo.lock');
      const command = 'cargo';
      const args = ['generate-lockfile', '--manifest-path', join(repoPath, 'Cargo.toml')];
      return {
        ecosystem,
        command,
        args,
        lockfilePath,
        fullCommand: `${command} ${args.join(' ')}`,
      };
    }
    case 'go': {
      const lockfilePath = join(repoPath, 'go.sum');
      const command = 'go';
      const args = ['mod', 'tidy'];
      return {
        ecosystem,
        command,
        args,
        lockfilePath,
        fullCommand: `${command} ${args.join(' ')}`,
      };
    }
  }
}

async function defaultExec(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, { cwd, env, shell: false });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill('SIGTERM');
        } catch (_err) {
          // ignore kill errors
          void _err;
        }
        resolve({
          exitCode: 124,
          stdout,
          stderr: stderr + '\n[timeout after ' + timeoutMs + 'ms]',
        });
      }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }
    child.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: 127, stdout, stderr: stderr + '\n[spawn error: ' + err.message + ']' });
      }
    });
    child.on('close', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });
  });
}

/**
 * Regenerate an ecosystem-appropriate lockfile for the merged manifest.
 *
 * - Dispatches per inferred ecosystem (npm/python/cargo/go).
 * - Runs the ecosystem's lockfile command in `repoPath` with offline guards.
 * - Validates the expected lockfile path exists after the command.
 * - Returns a typed `Result` with `LockfileResult` on success, or a
 *   `StitchError` with `LOCKFILE_GENERATION_FAILED` / `LOCKFILE_NOT_CREATED`.
 *
 * Never throws; all failures are typed `Result` errs.
 */
export async function regenerateLockfile(
  manifest: UnifiedManifest,
  repoPath: string,
  opts: RegenerateLockfileOptions = {}
): Promise<Result<LockfileResult, StitchError>> {
  const allowNetwork = opts.allowNetwork ?? true;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const execImpl =
    opts.execImpl ??
    ((cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) =>
      defaultExec(cmd, args, cwd, env, timeoutMs));
  const existsImpl = opts.existsImpl ?? pathExists;

  // Validate repoPath
  if (typeof repoPath !== 'string' || repoPath.trim().length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'regenerateLockfile requires a non-empty repoPath',
    });
  }

  const ecosystem = inferEcosystem(manifest);
  if (ecosystem === null) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'ecosystem',
      message: 'cannot infer ecosystem from manifest: unknown shape',
    });
  }

  const cmd = buildLockfileCommand(ecosystem, repoPath);

  // Build env with offline guards when network is disallowed
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!allowNetwork) {
    // npm/bun
    env['BUN_CONFIG_REGISTRY'] = 'http://offline.invalid';
    env['NPM_CONFIG_REGISTRY'] = 'http://offline.invalid';
    // Go
    env['GOPROXY'] = 'off';
    env['GOSUMDB'] = 'off';
    // Cargo
    env['CARGO_NET_OFFLINE'] = 'true';
    // Python/uv
    env['UV_OFFLINE'] = '1';
    env['PIP_NO_INDEX'] = '1';
  }

  let execResult: { exitCode: number; stdout: string; stderr: string };
  try {
    execResult = await execImpl(cmd.command, cmd.args, repoPath, env);
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: `regenerateLockfile exec threw: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const { exitCode, stdout, stderr } = execResult;

  if (exitCode !== 0) {
    return err({
      code: 'LOCKFILE_GENERATION_FAILED',
      command: cmd.fullCommand,
      exitCode,
      stderr: stderr || stdout || `command failed with exit code ${exitCode}`,
    });
  }

  let exists: boolean;
  try {
    exists = await existsImpl(cmd.lockfilePath);
  } catch (e) {
    return err({
      code: 'INTERNAL',
      message: `lockfile existence check threw: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (!exists) {
    return err({
      code: 'LOCKFILE_NOT_CREATED',
      lockfilePath: cmd.lockfilePath,
      command: cmd.fullCommand,
      stderr: stderr || `lockfile not found at ${cmd.lockfilePath} after ${cmd.fullCommand}`,
    });
  }

  const result: LockfileResult = {
    ecosystem,
    lockfilePath: cmd.lockfilePath,
    command: cmd.fullCommand,
    exitCode,
    stdout,
    stderr,
    createdAt: new Date().toISOString(),
  };

  return ok(result);
}

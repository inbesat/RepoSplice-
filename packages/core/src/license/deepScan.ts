// Per-file header scan via scancode-toolkit (P-124, P-129).
//
// Strictly opt-in via config.licensePolicy.deepScan (default false).
// When off, returns scanner:'none' without spawning a subprocess.
// When on, shells out to scancode, parses its JSON, and maps to DeepScanFile[].
// Refactored to use LicenseScanner plugin interface (P-129).

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { DeepScanFile, DeepScanResult } from './types.js';
import type { LicenseScanner, DeepScanConfig } from './plugin.js';
import { getScanner, hasScanner, registerScanner } from './plugin.js';

export type { DeepScanFile, DeepScanResult } from './types.js';

// Legacy config for backward compatibility with P-124 tests
interface LegacyDeepScanConfig {
  deepScan?: boolean;
  scanCodePath?: string | undefined;
}

let globalDeepScanConfig: LegacyDeepScanConfig = {
  deepScan: false,
  scanCodePath: undefined,
};

let execImpl:
  | ((
      binary: string,
      args: string[],
      cwd: string
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>)
  | null = null;

/**
 * Set deepScan config for tests / runtime injection (P-124 compatibility).
 * @deprecated Use plugin registry with DeepScanConfig instead.
 */
export function setDeepScanConfigForTests(config: LegacyDeepScanConfig): void {
  globalDeepScanConfig = { ...config };
}

/** Reset to defaults (deepScan:false). */
export function clearDeepScanConfigForTests(): void {
  globalDeepScanConfig = { deepScan: false, scanCodePath: undefined };
}

/** Inject a custom exec implementation for tests (avoids needing a real scancode binary). */
export function setDeepScanExecForTests(
  fn:
    | ((
        binary: string,
        args: string[],
        cwd: string
      ) => Promise<{ exitCode: number; stdout: string; stderr: string }>)
    | null
): void {
  execImpl = fn;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

async function runScancodeBinary(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (execImpl !== null) {
    return execImpl(binary, args, cwd);
  }

  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(binary, args, {
      cwd,
      shell: false,
      env: process.env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // process already exited; nothing to kill
      }
      resolve({
        exitCode: 124,
        stdout,
        stderr: stderr + '\n[timeout after ' + timeoutMs + 'ms]',
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error: Error & { code?: string }) => {
      clearTimeout(timer);
      const code = error.code ?? 'UNKNOWN';
      // ENOENT means binary missing
      if (code === 'ENOENT') {
        resolve({
          exitCode: 127,
          stdout,
          stderr: 'ENOENT: ' + error.message,
        });
      } else {
        resolve({
          exitCode: 127,
          stdout,
          stderr: error.message,
        });
      }
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      const exitCode = code ?? 0;
      resolve({ exitCode, stdout, stderr });
    });
  });
}

/**
 * ScanCode implementation of the LicenseScanner interface.
 * This encapsulates the scancode-toolkit subprocess logic.
 */
class ScanCodeScanner implements LicenseScanner {
  readonly id = 'scancode';

  async scan(
    repoPath: string,
    config: DeepScanConfig
  ): Promise<Result<DeepScanResult, StitchError>> {
    const isOptIn = config.deepScan === true;

    if (!isOptIn) {
      return ok({
        scanner: 'none',
        files: [],
        totalFiles: 0,
        scannedAt: isoNow(),
        optIn: false,
      });
    }

    if (repoPath.trim().length === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: 'repoPath must be a non-empty string',
      });
    }

    const binary = config.scanCodePath ?? 'scancode';

    // If a custom path was provided, verify it exists before spawning to give a
    // clear SCANCODE_MISSING. Skip this pre-flight when a runner is injected (a
    // test seam owns its own binary resolution and reports its own errors).
    if (execImpl === null && config.scanCodePath !== undefined) {
      const exists = await fileExists(config.scanCodePath);
      if (!exists) {
        return err({
          code: 'SCANCODE_MISSING',
          message: 'scancode binary not found at ' + config.scanCodePath,
          action: 'install scancode-toolkit via pip',
          optInPath: config.scanCodePath,
        });
      }
    }

    const args = [
      '--json-pp',
      '-',
      '--license',
      '--copyright',
      '--only-findings',
      '--ignore',
      '**/.git/**',
      repoPath,
    ];

    const timeoutMs = 300_000;

    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await runScancodeBinary(binary, args, repoPath, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'SCANCODE_FAILED',
        message: 'scancode spawn failed: ' + message,
        stderr: message,
      });
    }

    // Handle ENOENT / missing binary (exit 127 with ENOENT in stderr)
    if (result.exitCode === 127 && result.stderr.includes('ENOENT')) {
      return err({
        code: 'SCANCODE_MISSING',
        message: 'scancode binary not found: ' + binary,
        action: 'install scancode-toolkit via pip',
        ...(config.scanCodePath !== undefined ? { optInPath: config.scanCodePath } : {}),
      });
    }

    if (result.exitCode !== 0) {
      return err({
        code: 'SCANCODE_FAILED',
        message:
          'scancode exited with code ' + result.exitCode + ': ' + result.stderr.slice(0, 500),
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'SCANCODE_FAILED',
        message: 'scancode returned invalid JSON: ' + message,
        stderr: result.stdout.slice(0, 1000),
      });
    }

    // Expected shape: { files: [{ path, licenses: [{spdx_license_key}], copyrights: [{value}] }, ...] }
    // Also handles { files: [] } or { headers: ... }
    const filesRaw: unknown[] =
      parsed !== null &&
      typeof parsed === 'object' &&
      'files' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).files)
        ? ((parsed as Record<string, unknown>).files as unknown[])
        : [];

    const files: DeepScanFile[] = [];

    for (const entry of filesRaw) {
      if (entry === null || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const rawPath = typeof obj.path === 'string' ? obj.path : '';
      if (rawPath.length === 0) continue;

      // Exclude .git paths defensively even though scancode was told to ignore
      if (rawPath.includes('.git/') || rawPath.startsWith('.git')) continue;

      const licensesRaw = Array.isArray(obj.licenses) ? obj.licenses : [];
      const copyrightsRaw = Array.isArray(obj.copyrights) ? obj.copyrights : [];

      const licenses: string[] = [];
      for (const lic of licensesRaw) {
        if (lic === null || typeof lic !== 'object') continue;
        const l = lic as Record<string, unknown>;
        const key = typeof l.spdx_license_key === 'string' ? l.spdx_license_key : '';
        if (key.length > 0) licenses.push(key);
        else if (typeof l.license === 'string' && l.license.length > 0) licenses.push(l.license);
      }

      const copyrights: string[] = [];
      for (const cp of copyrightsRaw) {
        if (cp === null || typeof cp !== 'object') continue;
        const c = cp as Record<string, unknown>;
        const val =
          typeof c.value === 'string'
            ? c.value
            : typeof c.copyright === 'string'
              ? c.copyright
              : '';
        if (val.length > 0) copyrights.push(val);
      }

      // Filter out empty files (no findings)
      if (licenses.length === 0 && copyrights.length === 0) continue;

      // Dedupe licenses/copyrights preserve order
      const dedupedLicenses = [...new Set(licenses)];
      const dedupedCopyrights = [...new Set(copyrights)];

      files.push({
        path: rawPath,
        licenses: dedupedLicenses,
        copyrights: dedupedCopyrights,
      });
    }

    // Sort for determinism
    files.sort((a, b) => {
      if (a.path < b.path) return -1;
      if (a.path > b.path) return 1;
      return 0;
    });

    return ok({
      scanner: 'scancode',
      files,
      totalFiles: files.length,
      scannedAt: isoNow(),
      optIn: true,
    });
  }
}

const scanCodeScanner = new ScanCodeScanner();
if (!hasScanner(scanCodeScanner.id)) {
  registerScanner(scanCodeScanner);
}

/**
 * Run ScanCode on repoPath when opt-in is true.
 * Preserves the provided signature from P-124:
 * runScanCode(repoPath: string): Promise<Result<DeepScanResult, StitchError>>
 *
 * Now delegates to the plugin registry.
 * For backward compatibility, still reads from globalDeepScanConfig if no
 * DeepScanConfig is provided, but the new API should use the plugin directly.
 */
export async function runScanCode(repoPath: string): Promise<Result<DeepScanResult, StitchError>> {
  // Convert legacy config to new DeepScanConfig
  const config: DeepScanConfig = {
    ...(globalDeepScanConfig.deepScan !== undefined
      ? { deepScan: globalDeepScanConfig.deepScan }
      : {}),
    ...(globalDeepScanConfig.scanCodePath !== undefined
      ? { scanCodePath: globalDeepScanConfig.scanCodePath }
      : {}),
    scanner: 'scancode',
  };

  return getScanner('scancode').scan(repoPath, config);
}

// Re-export the plugin interface and functions for consumers

export type { DeepScanConfig } from './plugin.js';

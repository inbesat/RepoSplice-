// Deep-scan plugin interface and registry (P-129).
//
// Defines the LicenseScanner interface so future scanners (FOSSA, Snyk, custom)
// can be added without rewriting the scan pipeline. ScanCode is the default
// implementation.

import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { DeepScanResult } from './types.js';

export interface DeepScanConfig {
  deepScan?: boolean;
  scanner?: string;
  scanCodePath?: string;
}

/**
 * LicenseScanner interface for deep-scan plugins.
 * Implementations must return Result<DeepScanResult, StitchError>.
 */
export interface LicenseScanner {
  id: string;
  scan(repoPath: string, config: DeepScanConfig): Promise<Result<DeepScanResult, StitchError>>;
}

// Scanner registry
const scannerRegistry = new Map<string, LicenseScanner>();

/**
 * Register a new license scanner.
 * @param scanner - Scanner implementation with unique id
 */
export function registerScanner(scanner: LicenseScanner): void {
  if (scannerRegistry.has(scanner.id)) {
    throw new Error(`Scanner with id "${scanner.id}" already registered`);
  }
  scannerRegistry.set(scanner.id, scanner);
}

/**
 * Get a registered scanner by id.
 * @param id - Scanner id
 * @throws If scanner not found
 */
export function getScanner(id: string): LicenseScanner {
  const scanner = scannerRegistry.get(id);
  if (!scanner) {
    throw new Error(`Unknown scanner id: "${id}"`);
  }
  return scanner;
}

/**
 * Check if a scanner is registered.
 */
export function hasScanner(id: string): boolean {
  return scannerRegistry.has(id);
}

/**
 * Get all registered scanner ids.
 */
export function getRegisteredScanners(): string[] {
  return [...scannerRegistry.keys()];
}

/**
 * Run a deep scan using the configured scanner.
 *
 * @param repoPath - Path to the repository to scan
 * @param config - Deep scan configuration (deepScan, scanner id, scanner-specific options)
 * @returns Result with DeepScanResult or StitchError
 *
 * Behavior:
 * - If config.deepScan !== true, returns no-op 'none' result without spawning
 * - If config.scanner not set, uses 'scancode' as default
 * - Dispatches to the registered scanner's scan method
 * - All errors mapped to StitchError
 */
export async function runDeepScan(
  repoPath: string,
  config: DeepScanConfig
): Promise<Result<DeepScanResult, StitchError>> {
  const isOptIn = config.deepScan === true;

  if (!isOptIn) {
    return ok({
      scanner: 'none',
      files: [],
      totalFiles: 0,
      scannedAt: new Date().toISOString(),
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

  const scannerId = config.scanner ?? 'scancode';

  let scanner: LicenseScanner;
  try {
    scanner = getScanner(scannerId);
  } catch {
    return err({
      code: 'CONFIG_ERROR',
      field: 'scanner',
      message: `Unknown scanner "${scannerId}"`,
    });
  }

  return scanner.scan(repoPath, config);
}

/** Clear all registered scanners (test helper). */
export function clearScannerRegistryForTests(): void {
  scannerRegistry.clear();
}

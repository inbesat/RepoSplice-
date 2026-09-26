import { ok } from 'neverthrow';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerScanner,
  getScanner,
  hasScanner,
  runDeepScan,
  clearScannerRegistryForTests,
  type LicenseScanner,
  type DeepScanConfig,
} from './plugin.js';
import './deepScan.js';
import type { DeepScanResult } from './types.js';

function makeFakeResult(): DeepScanResult {
  return {
    scanner: 'scancode',
    files: [],
    totalFiles: 0,
    scannedAt: new Date().toISOString(),
    optIn: true,
  };
}

beforeEach(() => {
  const scancode = getScanner('scancode');
  clearScannerRegistryForTests();
  registerScanner(scancode);
});

describe('P-129 plugin: registry', () => {
  it('registers and retrieves scanners', () => {
    const fake: LicenseScanner = {
      id: 'fake-retrieve',
      scan: async () => ok(makeFakeResult()),
    };
    registerScanner(fake);
    expect(getScanner('fake-retrieve')).toBe(fake);
    expect(hasScanner('fake-retrieve')).toBe(true);
  });

  it('throws on unknown scanner id', () => {
    expect(() => getScanner('unknown')).toThrow();
  });
});

describe('P-129 plugin: dispatch', () => {
  it('dispatches by id via runDeepScan', async () => {
    const scanMock = vi.fn(async (_repoPath: string, _config: DeepScanConfig) =>
      ok(makeFakeResult())
    );
    const fake: LicenseScanner = { id: 'fake-dispatch', scan: scanMock };
    registerScanner(fake);
    const config: DeepScanConfig = { deepScan: true, scanner: 'fake-dispatch' };
    const result = await runDeepScan('/tmp/repo', config);
    expect(result.isOk()).toBe(true);
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledWith('/tmp/repo', config);
  });

  it('no-ops when deepScan off', async () => {
    const scanMock = vi.fn(async () => ok(makeFakeResult()));
    const fake: LicenseScanner = { id: 'fake-noop', scan: scanMock };
    registerScanner(fake);
    const result = await runDeepScan('/tmp/repo', {
      deepScan: false,
      scanner: 'fake-noop',
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('none');
      expect(result.value.optIn).toBe(false);
      expect(result.value.files).toEqual([]);
    }
    expect(scanMock).not.toHaveBeenCalled();
  });

  it('scancode default preserved', async () => {
    const scanner = getScanner('scancode');
    expect(scanner.id).toBe('scancode');
    const result = await runDeepScan('/tmp/repo', { deepScan: false });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('none');
    }
  });
});

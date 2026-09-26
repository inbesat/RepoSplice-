import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runScanCode,
  setDeepScanConfigForTests,
  clearDeepScanConfigForTests,
  setDeepScanExecForTests,
} from './deepScan.js';

beforeEach(() => {
  clearDeepScanConfigForTests();
  setDeepScanExecForTests(null);
});

describe('P-124 deepScan: skips when opt-in is off', () => {
  it('skips when opt-in is off', async () => {
    setDeepScanConfigForTests({ deepScan: false });
    const execMock = vi.fn(async () => {
      throw new Error('should not be called');
    });
    setDeepScanExecForTests(
      execMock as unknown as (
        binary: string,
        args: string[],
        cwd: string
      ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
    );
    const result = await runScanCode('/tmp/some-repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('none');
      expect(result.value.optIn).toBe(false);
      expect(result.value.files).toEqual([]);
      expect(result.value.totalFiles).toBe(0);
    }
    expect(execMock).not.toHaveBeenCalled();
  });
});

describe('P-124 deepScan: parses scancode JSON output', () => {
  it('parses scancode JSON output', async () => {
    setDeepScanConfigForTests({ deepScan: true, scanCodePath: '/tmp/fake-scancode' });
    const fakeJson = JSON.stringify({
      files: [
        {
          path: 'src/index.ts',
          licenses: [{ spdx_license_key: 'MIT' }],
          copyrights: [{ value: 'Copyright (c) 2024 Alice' }],
        },
        {
          path: 'src/utils.ts',
          licenses: [{ spdx_license_key: 'Apache-2.0' }, { spdx_license_key: 'MIT' }],
          copyrights: [{ value: 'Copyright (c) 2024 Bob' }, { value: 'Copyright (c) 2024 Alice' }],
        },
        {
          path: '.git/HEAD',
          licenses: [{ spdx_license_key: 'MIT' }],
          copyrights: [],
        },
        {
          path: 'empty.txt',
          licenses: [],
          copyrights: [],
        },
      ],
    });
    setDeepScanExecForTests(async () => ({
      exitCode: 0,
      stdout: fakeJson,
      stderr: '',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('scancode');
      expect(result.value.optIn).toBe(true);
      // .git and empty files should be filtered out
      expect(result.value.files).toHaveLength(2);
      expect(result.value.files[0]?.path).toBe('src/index.ts');
      expect(result.value.files[0]?.licenses).toEqual(['MIT']);
      expect(result.value.files[0]?.copyrights).toEqual(['Copyright (c) 2024 Alice']);
      expect(result.value.files[1]?.path).toBe('src/utils.ts');
      expect(result.value.files[1]?.licenses).toEqual(['Apache-2.0', 'MIT']);
      expect(result.value.totalFiles).toBe(2);
      expect(result.value.scannedAt).toBeTruthy();
    }
  });
});

describe('P-124 deepScan: flags unexpected per-file license', () => {
  it('flags unexpected per-file license', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    const fakeJson = JSON.stringify({
      files: [
        {
          path: 'src/secret.ts',
          licenses: [{ spdx_license_key: 'GPL-3.0-only' }],
          copyrights: [{ value: 'Copyright (c) 2024 Carol' }],
        },
        {
          path: 'src/normal.ts',
          licenses: [{ spdx_license_key: 'MIT' }],
          copyrights: [],
        },
      ],
    });
    setDeepScanExecForTests(async () => ({
      exitCode: 0,
      stdout: fakeJson,
      stderr: '',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Both files should be present; the GPL one is unexpected if declared is MIT-only
      const gplFile = result.value.files.find(f => f.path === 'src/secret.ts');
      expect(gplFile).toBeDefined();
      expect(gplFile?.licenses).toContain('GPL-3.0-only');
      // Simulate declared set: ['MIT'] – GPL is not in declared, so it's unexpected
      const declaredLicenses = ['MIT'];
      const unexpected = result.value.files.filter(f =>
        f.licenses.some(lic => !declaredLicenses.includes(lic))
      );
      expect(unexpected).toHaveLength(1);
      expect(unexpected[0]?.path).toBe('src/secret.ts');
    }
  });
});

describe('P-124 deepScan: errors when binary missing', () => {
  it('errors when binary missing', async () => {
    setDeepScanConfigForTests({
      deepScan: true,
      scanCodePath: '/tmp/does-not-exist-scancode-xyz-12345',
    });
    // No exec mock – it will check fileExists and return SCANCODE_MISSING before spawning
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('SCANCODE_MISSING');
      if (result.error.code === 'SCANCODE_MISSING') {
        expect(result.error.message).toMatch(/not found/i);
        expect(result.error.action).toMatch(/install scancode/i);
      }
    }
  });
});

describe('P-124 deepScan: maps bad JSON to SCANCODE_FAILED', () => {
  it('maps bad JSON to SCANCODE_FAILED', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({
      exitCode: 0,
      stdout: 'this is not json{{{',
      stderr: '',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('SCANCODE_FAILED');
      if (result.error.code === 'SCANCODE_FAILED') {
        expect(result.error.message).toMatch(/invalid JSON/i);
      }
    }
  });

  it('maps non-zero exit to SCANCODE_FAILED', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'scancode failed: some error',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('SCANCODE_FAILED');
      if (result.error.code === 'SCANCODE_FAILED') {
        expect(result.error.message).toMatch(/exited with code 1/i);
      }
    }
  });
});

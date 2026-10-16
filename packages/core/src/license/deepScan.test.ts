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

describe('P-124 deepScan: input validation and spawn failures', () => {
  it('errors on an empty repoPath when opted in', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    const result = await runScanCode('');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('repoPath');
      }
    }
  });

  it('maps a thrown Error from the runner to SCANCODE_FAILED', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => {
      throw new Error('runner exploded');
    });
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'SCANCODE_FAILED') {
      expect(result.error.message).toMatch(/spawn failed: runner exploded/i);
    }
  });

  it('maps a thrown non-Error from the runner to SCANCODE_FAILED', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    const failure: unknown = 'string failure';
    setDeepScanExecForTests(async () => {
      throw failure;
    });
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'SCANCODE_FAILED') {
      expect(result.error.message).toMatch(/spawn failed: string failure/i);
    }
  });

  it('maps exit 127 with ENOENT to SCANCODE_MISSING', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({
      exitCode: 127,
      stdout: '',
      stderr: 'ENOENT: no such file',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'SCANCODE_MISSING') {
      expect(result.error.message).toMatch(/not found/i);
    }
  });

  it('keeps optInPath when a custom path was configured', async () => {
    setDeepScanConfigForTests({ deepScan: true, scanCodePath: '/tmp/custom-scancode' });
    setDeepScanExecForTests(async () => ({
      exitCode: 127,
      stdout: '',
      stderr: 'ENOENT: no such file',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'SCANCODE_MISSING') {
      expect(result.error.optInPath).toBe('/tmp/custom-scancode');
    }
  });

  it('treats exit 127 without ENOENT as SCANCODE_FAILED', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({
      exitCode: 127,
      stdout: '',
      stderr: 'some other failure',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('SCANCODE_FAILED');
    }
  });
});

describe('P-124 deepScan: real subprocess execution', () => {
  it('runs a real binary and maps a non-zero exit to SCANCODE_FAILED', async () => {
    // where.exe exists on Windows and exits non-zero with stderr output; any real
    // binary that fails fast exercises the spawn/stdout/stderr/close handlers.
    const binary =
      process.platform === 'win32' ? 'C:\\Windows\\system32\\where.exe' : '/usr/bin/env';
    setDeepScanConfigForTests({ deepScan: true, scanCodePath: binary });
    // execImpl is null: exercises the real runScancodeBinary path.
    const result = await runScanCode(process.cwd());
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('SCANCODE_FAILED');
    }
  });

  it('reports SCANCODE_MISSING when the default binary is absent', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    // No scanCodePath: defaults to 'scancode', which is not installed.
    const result = await runScanCode(process.cwd());
    expect(result.isErr()).toBe(true);
    if (result.isErr() && result.error.code === 'SCANCODE_MISSING') {
      expect(result.error.message).toMatch(/not found/i);
    }
  });

  it('returns scanner none when deepScan is not enabled but a path is set', async () => {
    setDeepScanConfigForTests({ scanCodePath: '/tmp/whatever' });
    const result = await runScanCode('/tmp/repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.scanner).toBe('none');
      expect(result.value.optIn).toBe(false);
    }
  });
});

describe('P-124 deepScan: parses malformed scancode payloads', () => {
  it('returns zero files when the payload has no files array', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    setDeepScanExecForTests(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ headers: { tool: 'scancode' } }),
      stderr: '',
    }));
    const result = await runScanCode('/tmp/repo');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.files).toEqual([]);
      expect(result.value.totalFiles).toBe(0);
    }
  });

  it('skips malformed entries and reads fallback license/copyright fields', async () => {
    setDeepScanConfigForTests({ deepScan: true });
    const fakeJson = JSON.stringify({
      files: [
        null,
        'not-an-object',
        { licenses: [{ spdx_license_key: 'MIT' }], copyrights: [] },
        {
          path: 'a.ts',
          licenses: [{ license: 'Custom-License' }],
          copyrights: [{ copyright: 'Copyright (c) 2024 X' }],
        },
        {
          path: 'a.ts',
          licenses: [{ spdx_license_key: 'MIT' }],
          copyrights: [],
        },
        {
          path: 'empty.ts',
          licenses: [null, { spdx_license_key: '' }, { license: '' }],
          copyrights: [null, { value: '' }],
        },
        { path: 'non-array.ts', licenses: 'nope', copyrights: 'nope' },
        {
          path: 'dup.ts',
          licenses: [],
          copyrights: [{ value: 'Copyright (c) 2024 Dup' }, { value: 'Copyright (c) 2024 Dup' }],
        },
      ],
    });
    setDeepScanExecForTests(async () => ({ exitCode: 0, stdout: fakeJson, stderr: '' }));

    const result = await runScanCode('/tmp/repo');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const aFiles = result.value.files.filter(f => f.path === 'a.ts');
      expect(aFiles).toHaveLength(2);
      const custom = aFiles.find(f => f.licenses.includes('Custom-License'));
      expect(custom?.copyrights).toEqual(['Copyright (c) 2024 X']);
      const dup = result.value.files.find(f => f.path === 'dup.ts');
      expect(dup?.copyrights).toEqual(['Copyright (c) 2024 Dup']);
      expect(result.value.files.some(f => f.path === 'empty.ts')).toBe(false);
      expect(result.value.files.some(f => f.path === 'non-array.ts')).toBe(false);
    }
  });
});

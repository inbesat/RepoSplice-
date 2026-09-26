import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { rm, readFile, pathExists, outputFile } from 'fs-extra';
import { generateLicense } from './generate.js';
import { clearDeepScanConfigForTests } from './deepScan.js';

const testRepoDir = join(resolve('.'), '.generate-test-repo');

beforeEach(async () => {
  clearDeepScanConfigForTests();
  await rm(testRepoDir, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(testRepoDir, { recursive: true, force: true });
});

async function readLicenseFile(repoPath: string): Promise<string> {
  return readFile(join(repoPath, 'LICENSE'), 'utf-8');
}

async function readPackageJson(repoPath: string): Promise<Record<string, unknown>> {
  const pkgPath = join(repoPath, 'package.json');
  if (await pathExists(pkgPath)) {
    const content = await readFile(pkgPath, 'utf-8');
    return JSON.parse(content);
  }
  return {};
}

describe('P-125 generate: writes MIT license with holder', () => {
  it('writes MIT license with holder', async () => {
    const result = await generateLicense('MIT', [{ name: 'Alice' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.licenseId).toBe('MIT');
      expect(result.value.path).toBe(join(testRepoDir, 'LICENSE'));
      expect(result.value.year).toBe(new Date().getFullYear().toString());
      expect(result.value.holderLines).toEqual(['Copyright (c) ' + result.value.year + ' Alice']);
      expect(result.value.checksumSha256).toBeTruthy();
    }
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('MIT License');
    expect(content).toContain('Copyright (c)');
    expect(content).toContain('Alice');
  });
});

describe('P-125 generate: renders each supported template', () => {
  it('renders MIT template', async () => {
    const result = await generateLicense('MIT', [{ name: 'Bob' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('MIT License');
    expect(content).toContain('Bob');
  });

  it('renders Apache-2.0 template', async () => {
    const result = await generateLicense('Apache-2.0', [{ name: 'Carol' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('Apache License');
    expect(content).toContain('Carol');
  });

  it('renders BSD-3-Clause template', async () => {
    const result = await generateLicense('BSD-3-Clause', [{ name: 'Dave' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('BSD 3-Clause License');
    expect(content).toContain('Dave');
  });

  it('renders GPL-3.0 template', async () => {
    const result = await generateLicense('GPL-3.0', [{ name: 'Eve' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(content).toContain('Eve');
  });

  it('renders MPL-2.0 template', async () => {
    const result = await generateLicense('MPL-2.0', [{ name: 'Frank' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('Mozilla Public License Version 2.0');
    expect(content).toContain('Frank');
  });
});

describe('P-125 generate: falls back for unsupported id', () => {
  it('falls back for unsupported id', async () => {
    const result = await generateLicense('Unknown-License-1.0', [{ name: 'Grace' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('Unknown-License-1.0 License');
    expect(content).toContain('SEE LICENSE in https://spdx.org/licenses/Unknown-License-1.0.html');
    expect(content).toContain('Grace');
  });
});

describe('P-125 generate: dedupes and sorts holders', () => {
  it('dedupes and sorts holders', async () => {
    const holders = [
      { name: 'Zoe' },
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Alice' }, // duplicate
    ];
    const result = await generateLicense('MIT', holders, testRepoDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.holderLines).toEqual([
        'Copyright (c) ' + result.value.year + ' Alice',
        'Copyright (c) ' + result.value.year + ' Bob',
        'Copyright (c) ' + result.value.year + ' Zoe',
      ]);
    }
    const content = await readLicenseFile(testRepoDir);
    // Should contain all three unique holders
    expect(content).toContain('Alice');
    expect(content).toContain('Bob');
    expect(content).toContain('Zoe');
    // Should only have Alice once
    const aliceCount = (content.match(/Alice/g) || []).length;
    expect(aliceCount).toBe(1);
  });
});

describe('P-125 generate: checksum matches file', () => {
  it('checksum matches file', async () => {
    const result = await generateLicense('MIT', [{ name: 'Henry' }], testRepoDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const content = await readLicenseFile(testRepoDir);
      const crypto = await import('node:crypto');
      const expectedHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
      expect(result.value.checksumSha256).toBe(expectedHash);
    }
  });
});

describe('P-125 generate: adds license field to package.json', () => {
  it('adds license field to package.json when missing', async () => {
    // Create a package.json without license field
    await outputFile(
      join(testRepoDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' }, null, 2)
    );

    const result = await generateLicense('MIT', [{ name: 'Ivy' }], testRepoDir);
    expect(result.isOk()).toBe(true);

    const pkg = await readPackageJson(testRepoDir);
    expect(pkg.license).toBe('MIT');
  });

  it('does not overwrite existing license field in package.json', async () => {
    // Create a package.json with existing license
    await outputFile(
      join(testRepoDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0', license: 'Apache-2.0' }, null, 2)
    );

    const result = await generateLicense('MIT', [{ name: 'Jack' }], testRepoDir);
    expect(result.isOk()).toBe(true);

    const pkg = await readPackageJson(testRepoDir);
    expect(pkg.license).toBe('Apache-2.0'); // Should remain unchanged
  });
});

describe('P-125 generate: error handling', () => {
  it('errors on empty licenseId', async () => {
    const result = await generateLicense('', [{ name: 'Test' }], testRepoDir);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('licenseId');
      }
    }
  });

  it('errors on empty repoPath', async () => {
    const result = await generateLicense('MIT', [{ name: 'Test' }], '');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('repoPath');
      }
    }
  });

  it('errors on empty holders array', async () => {
    const result = await generateLicense('MIT', [], testRepoDir);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('CONFIG_ERROR');
      if (result.error.code === 'CONFIG_ERROR') {
        expect(result.error.field).toBe('holders');
      }
    }
  });
});

describe('P-125 generate: year from holders', () => {
  it('uses max year from holders when provided', async () => {
    const holders = [
      { name: 'Alice', year: 2020 },
      { name: 'Bob', year: 2023 },
    ];
    const result = await generateLicense('MIT', holders, testRepoDir);
    expect(result.isOk()).toBe(true);
    const content = await readLicenseFile(testRepoDir);
    expect(content).toContain('Copyright (c) 2023 Alice');
    expect(content).toContain('Copyright (c) 2023 Bob');
  });
});

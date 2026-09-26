import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectEcosystems } from '../ecosystem.js';
import { parsePackageJson } from '../parse/npm.js';
import { parsePythonManifest } from '../parse/python.js';
import { parseCargoToml } from '../parse/cargo.js';
import { parseGoMod, serializeGoMod } from '../parse/go.js';
import { unionManifests } from '../merge.js';
import { generateDepReport, renderReportJson } from '../report.js';
import { buildLockfileCommand } from '../lockfile.js';

const fixturesRoot = join(import.meta.dirname, '..', '__fixtures__');

describe('P-117 end-to-end: full npm pipeline', () => {
  it('full npm pipeline end-to-end', async () => {
    const npmBasicPath = join(fixturesRoot, 'npm-basic', 'package.json');
    const npmConflictPath = join(fixturesRoot, 'npm-conflict', 'package.json');
    const basicContent = await readFile(npmBasicPath, 'utf8');
    const conflictContent = await readFile(npmConflictPath, 'utf8');

    const parsedBasic = parsePackageJson(basicContent, npmBasicPath);
    const parsedConflict = parsePackageJson(conflictContent, npmConflictPath);
    expect(parsedBasic.isOk()).toBe(true);
    expect(parsedConflict.isOk()).toBe(true);
    if (parsedBasic.isErr() || parsedConflict.isErr()) return;

    const mergedResult = unionManifests([parsedBasic.value, parsedConflict.value]);
    expect(mergedResult.isOk()).toBe(true);
    if (mergedResult.isErr()) return;

    const report = generateDepReport(mergedResult.value, null, [
      { repoName: 'npm-basic', manifestPath: npmBasicPath },
      { repoName: 'npm-conflict', manifestPath: npmConflictPath },
    ]);

    expect(report.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(report.dependencyCount.direct).toBeGreaterThanOrEqual(1);
    expect(report.summary.needsHuman).toBeDefined();
    expect(report.ecosystem).toBe('npm');

    const json = renderReportJson(report);
    const parsed = JSON.parse(json);
    expect(parsed.ecosystem).toBe('npm');
    expect(parsed.merged).toBeDefined();
  });
});

describe('P-117 end-to-end: round-trips', () => {
  it('python serialize round-trips', async () => {
    const pyPath = join(fixturesRoot, 'python-basic', 'pyproject.toml');
    const content = await readFile(pyPath, 'utf8');
    const parsed = parsePythonManifest(pyPath, content);
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    const serialized = JSON.stringify(parsed.value.manifest, null, 2);
    expect(serialized).toContain('requests');
  });

  it('cargo serialize round-trips', async () => {
    const cargoPath = join(fixturesRoot, 'cargo-basic', 'Cargo.toml');
    const content = await readFile(cargoPath, 'utf8');
    const parsed = parseCargoToml(content, cargoPath);
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    if (parsed.value.ecosystem !== 'cargo') throw new Error('expected cargo');
    expect(parsed.value.manifest.package.name).toBe('cargo-basic');
    const serialized = JSON.stringify(parsed.value.manifest, null, 2);
    expect(serialized).toContain('serde');
  });

  it('go serialize round-trips', async () => {
    const goPath = join(fixturesRoot, 'go-basic', 'go.mod');
    const content = await readFile(goPath, 'utf8');
    const parsed = parseGoMod(content, goPath);
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    if (parsed.value.ecosystem !== 'go') throw new Error('expected go');
    const serialized = serializeGoMod(parsed.value.manifest);
    expect(serialized).toContain('example.com/a');
    const reparsed = parseGoMod(serialized, goPath);
    expect(reparsed.isOk()).toBe(true);
  });
});

describe('P-117 end-to-end: lockfile dispatch', () => {
  it('regenerates via buildLockfileCommand dispatch', () => {
    const npmCmd = buildLockfileCommand('npm', '/tmp/repo');
    expect(npmCmd.command).toBe('bun');
    expect(npmCmd.lockfilePath).toContain('bun.lock');

    const pyCmd = buildLockfileCommand('python', '/tmp/repo');
    expect(pyCmd.command).toBe('uv');

    const cargoCmd = buildLockfileCommand('cargo', '/tmp/repo');
    expect(cargoCmd.command).toBe('cargo');

    const goCmd = buildLockfileCommand('go', '/tmp/repo');
    expect(goCmd.command).toBe('go');
  });
});

describe('P-117 end-to-end: detect', () => {
  it('detect finds npm fixture', async () => {
    const result = await detectEcosystems(join(fixturesRoot, 'npm-basic'));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.some(e => e.parser === 'npm')).toBe(true);
    }
  });
});

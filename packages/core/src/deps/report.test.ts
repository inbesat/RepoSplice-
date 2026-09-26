// P-116 tests: DependencyReport generation and JSON stability.
import { describe, expect, it } from 'vitest';
import { generateDepReport, renderReportJson } from './report.js';
import type { MergeResult, UnifiedManifest } from './types.js';
import type { LockfileResult } from './types.js';

function npmMergeResult(overrides?: Partial<MergeResult>): MergeResult {
  const base: UnifiedManifest = { dependencies: { lodash: '^4.17.21', react: '^18.0.0' } };
  return {
    merged: overrides?.merged ?? base,
    conflicts: overrides?.conflicts ?? [],
    warnings: overrides?.warnings ?? [],
  };
}

describe('P-116 report: classifies auto-resolved vs needs-attention', () => {
  it('auto-resolved when suggestedResolution present', () => {
    const result: MergeResult = npmMergeResult({
      conflicts: [
        {
          type: 'version',
          package: 'react',
          values: { 'repo-a': '^17.0.0', 'repo-b': '^18.0.0' },
          suggestedResolution: '^18.0.0',
          severity: 'warning',
        },
      ],
    });
    const report = generateDepReport(result, null, [
      { repoName: 'a', manifestPath: 'a/package.json' },
    ]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.status).toBe('auto-resolved');
    expect(report.conflicts[0]?.resolution).toBe('^18.0.0');
  });

  it('needs-attention when error without resolution', () => {
    const result: MergeResult = npmMergeResult({
      conflicts: [
        {
          type: 'version',
          package: 'react',
          values: { 'repo-a': '^17.0.0', 'repo-b': '^18.0.0' },
          severity: 'error',
        },
      ],
    });
    const report = generateDepReport(result, null, [
      { repoName: 'a', manifestPath: 'a/package.json' },
    ]);
    expect(report.conflicts[0]?.status).toBe('needs-attention');
    expect(report.conflicts[0]?.resolution).toBeUndefined();
  });

  it('warning when warning severity without resolution', () => {
    const result: MergeResult = npmMergeResult({
      conflicts: [
        {
          type: 'peer',
          package: 'react',
          values: { 'repo-a': '^17.0.0' },
          severity: 'warning',
        },
      ],
    });
    const report = generateDepReport(result, null, []);
    expect(report.conflicts[0]?.status).toBe('warning');
  });
});

describe('P-116 report: computes dependency counts', () => {
  it('counts direct/dev/peer for npm', () => {
    const merged: UnifiedManifest = {
      dependencies: { a: '1.0.0', b: '1.0.0' },
      devDependencies: { c: '1.0.0' },
      peerDependencies: { d: '1.0.0', e: '1.0.0' },
    };
    const result: MergeResult = { merged, conflicts: [], warnings: [] };
    const report = generateDepReport(result, null, []);
    expect(report.dependencyCount).toEqual({ direct: 2, dev: 1, peer: 2, total: 5 });
  });

  it('counts for fixture with mixed direct/dev/peer', () => {
    const merged: UnifiedManifest = {
      dependencies: { lodash: '^4.17.21' },
      devDependencies: { vitest: '^5.0.0' },
      peerDependencies: { react: '^18.0.0' },
    };
    const result: MergeResult = { merged, conflicts: [], warnings: [] };
    const report = generateDepReport(result, null, []);
    expect(report.dependencyCount.direct).toBe(1);
    expect(report.dependencyCount.dev).toBe(1);
    expect(report.dependencyCount.peer).toBe(1);
    expect(report.dependencyCount.total).toBe(3);
  });
});

describe('P-116 report: sets mergeable=false on unresolved', () => {
  it('mergeable false when needs-attention exists', () => {
    const result: MergeResult = npmMergeResult({
      conflicts: [
        {
          type: 'version',
          package: 'x',
          values: { 'repo-a': '1.0.0', 'repo-b': '2.0.0' },
          severity: 'error',
        },
      ],
    });
    const lockfile: LockfileResult = {
      ecosystem: 'npm',
      lockfilePath: '/tmp/bun.lock',
      command: 'bun install',
      exitCode: 0,
      stdout: '',
      stderr: '',
      createdAt: new Date().toISOString(),
    };
    const report = generateDepReport(result, lockfile, []);
    expect(report.summary.needsHuman).toBe(true);
    expect(report.summary.blockedBy).toEqual(['x']);
    expect(report.summary.mergeable).toBe(false);
  });

  it('mergeable true when no needs-attention and lockfile generated', () => {
    const result: MergeResult = npmMergeResult({ conflicts: [] });
    const lockfile: LockfileResult = {
      ecosystem: 'npm',
      lockfilePath: '/tmp/bun.lock',
      command: 'bun install',
      exitCode: 0,
      stdout: '',
      stderr: '',
      createdAt: new Date().toISOString(),
    };
    const report = generateDepReport(result, lockfile, []);
    expect(report.summary.needsHuman).toBe(false);
    expect(report.summary.mergeable).toBe(true);
  });

  it('mergeable false when lockfile failed', () => {
    const result: MergeResult = npmMergeResult({ conflicts: [] });
    const lockfile: LockfileResult = {
      ecosystem: 'npm',
      lockfilePath: '/tmp/bun.lock',
      command: 'bun install',
      exitCode: 1,
      stdout: '',
      stderr: 'failed',
      createdAt: new Date().toISOString(),
    };
    const report = generateDepReport(result, lockfile, []);
    // lockfile failed → status failed, mergeable false because not generated
    expect(report.lockfile?.status).toBe('failed');
    expect(report.summary.mergeable).toBe(false);
  });
});

describe('P-116 report: serializes lockfile status', () => {
  it('generated when exit 0', () => {
    const result = npmMergeResult();
    const lockfile: LockfileResult = {
      ecosystem: 'npm',
      lockfilePath: '/tmp/bun.lock',
      command: 'bun install --frozen-lockfile=false',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      createdAt: new Date().toISOString(),
    };
    const report = generateDepReport(result, lockfile, []);
    expect(report.lockfile).toEqual({
      status: 'generated',
      path: '/tmp/bun.lock',
      command: 'bun install --frozen-lockfile=false',
    });
  });

  it('failed when exit non-zero', () => {
    const result = npmMergeResult();
    const lockfile: LockfileResult = {
      ecosystem: 'npm',
      lockfilePath: '/tmp/bun.lock',
      command: 'bun install',
      exitCode: 1,
      stdout: '',
      stderr: 'error',
      createdAt: new Date().toISOString(),
    };
    const report = generateDepReport(result, lockfile, []);
    expect(report.lockfile?.status).toBe('failed');
    expect(report.lockfile?.error).toBe('error');
  });

  it('null when lockfile null (skipped)', () => {
    const result = npmMergeResult();
    const report = generateDepReport(result, null, []);
    expect(report.lockfile).toBeNull();
    expect(report.summary.mergeable).toBe(false);
  });
});

describe('P-116 report: output is deterministic JSON', () => {
  it('is parseable and stable', () => {
    const result: MergeResult = {
      merged: { dependencies: { b: '2.0.0', a: '1.0.0' } },
      conflicts: [
        {
          type: 'version',
          package: 'z',
          values: { 'repo-b': '2.0.0', 'repo-a': '1.0.0' },
          severity: 'error',
        },
        {
          type: 'version',
          package: 'a',
          values: { 'repo-a': '1.0.0', 'repo-b': '2.0.0' },
          severity: 'error',
        },
      ],
      warnings: [],
    };
    const report = generateDepReport(result, null, [
      { repoName: 'b', manifestPath: 'b/package.json' },
      { repoName: 'a', manifestPath: 'a/package.json' },
    ]);
    const json1 = renderReportJson(report);
    const json2 = renderReportJson(report);
    expect(json1).toBe(json2);
    const parsed = JSON.parse(json1);
    expect(parsed).toHaveProperty('generatedAt');
    expect(parsed).toHaveProperty('ecosystem');
    // Keys should be sorted at top level
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it('sorts nested keys', () => {
    const result: MergeResult = {
      merged: { dependencies: { b: '2.0.0', a: '1.0.0' } },
      conflicts: [],
      warnings: [],
    };
    const report = generateDepReport(result, null, []);
    const json = renderReportJson(report);
    // Ensure merged keys are sorted
    expect(json).toContain('"a": "1.0.0"');
    // The JSON should be pretty printed with 2 spaces
    expect(json).toMatch(/\n {2}"/);
  });
});

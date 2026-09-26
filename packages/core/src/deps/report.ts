// Dependency report builder for deps pipeline (P-116).
//
// Produces a single machine-readable `DependencyReport` summarizing the
// merge outcome: merged manifest, per-section counts, every conflict with
// status, dedupe strategy, scripts collisions, lockfile status, and
// mergeable/needsHuman summary. Fed to CLI (P-196), web UI (P-219), and
// provenance (P-311). Pure data assembly, never throws.

import type { Conflict, DependencyReport, MergeResult, UnifiedManifest } from './types.js';
import type { LockfileResult } from './types.js';
import type { DedupeResult } from './dedupe.js';

function inferEcosystemFromMerged(merged: UnifiedManifest): 'npm' | 'python' | 'cargo' | 'go' {
  if (
    'package' in merged &&
    'dependencies' in merged &&
    typeof (merged as { package?: unknown }).package === 'object'
  ) {
    return 'cargo';
  }
  if ('module' in merged && 'require' in merged) return 'go';
  if ('source' in merged && 'dependencies' in merged) return 'python';
  return 'npm';
}

function countDependencies(merged: UnifiedManifest): {
  direct: number;
  dev: number;
  peer: number;
  total: number;
} {
  let direct = 0;
  let dev = 0;
  let peer = 0;

  if ('dependencies' in merged && merged.dependencies !== undefined) {
    direct = Object.keys(merged.dependencies as Record<string, unknown>).length;
  }
  // npm uses devDependencies/peerDependencies, python uses devDependencies, cargo devDependencies, go has require as direct
  if (
    'devDependencies' in merged &&
    (merged as { devDependencies?: Record<string, unknown> }).devDependencies !== undefined
  ) {
    dev = Object.keys(
      (merged as { devDependencies: Record<string, unknown> }).devDependencies
    ).length;
  }
  if (
    'peerDependencies' in merged &&
    (merged as { peerDependencies?: Record<string, unknown> }).peerDependencies !== undefined
  ) {
    peer = Object.keys(
      (merged as { peerDependencies: Record<string, unknown> }).peerDependencies
    ).length;
  }
  // For go, direct is require count already handled; for python/cargo, peer stays 0
  if (
    'require' in merged &&
    (merged as { require?: Record<string, unknown> }).require !== undefined
  ) {
    direct = Object.keys((merged as { require: Record<string, unknown> }).require).length;
  }

  // For npm, if dependencies was undefined, direct stays 0
  return { direct, dev, peer, total: direct + dev + peer };
}

function sortKeys<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(item => sortKeys(item)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const k of keys) {
      sorted[k] = sortKeys((obj as Record<string, unknown>)[k]);
    }
    return sorted as T;
  }
  return obj;
}

export function generateDepReport(
  result: MergeResult,
  lockfile: LockfileResult | null,
  inputSources: { repoName: string; manifestPath: string }[]
): DependencyReport {
  const ecosystem = inferEcosystemFromMerged(result.merged);
  const dependencyCount = countDependencies(result.merged);

  const conflicts = result.conflicts.map(
    (c): Conflict & { status: import('./types.js').ConflictStatus; resolution?: string } => {
      let status: import('./types.js').ConflictStatus;
      if (c.suggestedResolution !== undefined && c.suggestedResolution.length > 0) {
        status = 'auto-resolved';
      } else if (c.severity === 'error') {
        status = 'needs-attention';
      } else {
        status = 'warning';
      }
      return {
        ...c,
        status,
        ...(c.suggestedResolution !== undefined ? { resolution: c.suggestedResolution } : {}),
      };
    }
  );

  const dedupe: DedupeResult[] = result.conflicts
    .filter(c => c.dedupeStrategy !== undefined)
    .map(c => ({
      strategy: c.dedupeStrategy as DedupeResult['strategy'],
      version: c.suggestedResolution ?? '',
      reason: c.suggestedResolution ?? `${c.package} dedupe ${c.dedupeStrategy ?? ''}`.trim(),
    }));

  const scriptsMerged =
    'scripts' in result.merged &&
    (result.merged as { scripts?: Record<string, string> }).scripts !== undefined
      ? (result.merged as { scripts: Record<string, string> }).scripts
      : {};
  const scriptCollisions = result.conflicts.filter(c => c.type === 'script');

  let lockfileSection: DependencyReport['lockfile'] = null;
  if (lockfile !== null) {
    if (lockfile.exitCode === 0) {
      lockfileSection = {
        status: 'generated',
        path: lockfile.lockfilePath,
        command: lockfile.command,
      };
    } else {
      lockfileSection = {
        status: 'failed',
        path: lockfile.lockfilePath,
        command: lockfile.command,
        error: lockfile.stderr || `exit ${lockfile.exitCode}`,
      };
    }
  }

  // If lockfile is null and we want to distinguish skipped vs not run,
  // leave as null (caller can decide). For report, null means skipped.
  // If we want explicit skipped, caller can pass a LockfileResult with status.

  const needsHuman = conflicts.some(c => c.status === 'needs-attention');
  const blockedBy = conflicts.filter(c => c.status === 'needs-attention').map(c => c.package);
  const mergeable =
    !needsHuman && lockfileSection !== null && lockfileSection.status === 'generated';

  const report: DependencyReport = {
    generatedAt: new Date().toISOString(),
    ecosystem,
    inputSources: [...inputSources],
    merged: result.merged,
    dependencyCount,
    conflicts,
    dedupe,
    scripts: { merged: { ...scriptsMerged }, collisions: [...scriptCollisions] },
    lockfile: lockfileSection,
    summary: { mergeable, needsHuman, blockedBy },
  };

  return report;
}

export function renderReportJson(report: DependencyReport): string {
  const sorted = sortKeys(report);
  return JSON.stringify(sorted, null, 2);
}

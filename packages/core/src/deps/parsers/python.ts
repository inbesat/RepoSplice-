// Python parser plugin (P-115) — wraps P-105.
import { join } from 'node:path';
import { pathExists } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ParsedManifest, MergeResult } from '../types.js';
import { parsePythonManifest } from '../parse/python.js';
import { mergePython } from '../merge-impl.js';
import { regenerateLockfile as sharedRegenerateLockfile } from '../lockfile.js';
import type { Ecosystem, ManifestParser } from '../plugin.js';
import { registerParser } from '../plugin.js';
import type { LockfileResult } from '../types.js';

export const pythonParser: ManifestParser = {
  ecosystem: 'python' as Ecosystem,
  async detect(repoPath: string): Promise<boolean> {
    try {
      const pyproject = await pathExists(join(repoPath, 'pyproject.toml'));
      if (pyproject) return true;
      // Check for requirements*.txt via glob-like check — for now check common names
      const req = await pathExists(join(repoPath, 'requirements.txt'));
      if (req) return true;
      const reqDev = await pathExists(join(repoPath, 'requirements-dev.txt'));
      if (reqDev) return true;
      return false;
    } catch {
      return false;
    }
  },
  parse(content: string, filePath: string): Result<ParsedManifest, StitchError> {
    return parsePythonManifest(filePath, content);
  },
  serialize(manifest: ParsedManifest): string {
    if (manifest.ecosystem !== 'python') {
      throw new Error(`python parser cannot serialize ${manifest.ecosystem} manifest`);
    }
    // For now, serialize as JSON for python — actual python serialize is not yet fully implemented
    // Use a simple representation; P-115 keeps parsers thin and delegates to existing modules
    // For python, we don't have a serialize yet, so return JSON
    return JSON.stringify(manifest.manifest, null, 2);
  },
  merge(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
    const filtered = manifests.filter(
      (m): m is Extract<ParsedManifest, { ecosystem: 'python' }> => m.ecosystem === 'python'
    );
    if (filtered.length === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'manifests',
        message: 'python parser merge requires at least one python manifest',
      });
    }
    const narrowed = filtered.map(m => ({ manifest: m.manifest, path: m.path }));
    const result = mergePython(narrowed);
    return ok({ merged: result.merged, conflicts: result.conflicts, warnings: result.warnings });
  },
  async regenerateLockfile(
    manifest: ParsedManifest,
    repoPath: string
  ): Promise<Result<LockfileResult, StitchError>> {
    if (manifest.ecosystem !== 'python') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ecosystem',
        message: `python parser cannot regenerate lockfile for ${manifest.ecosystem}`,
      });
    }
    const unified = manifest.manifest as unknown as import('../types.js').UnifiedManifest;
    return sharedRegenerateLockfile(unified, repoPath);
  },
};

registerParser(pythonParser);

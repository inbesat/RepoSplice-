// npm parser plugin (P-115) — wraps P-104 parse/serialize and P-108 merge.
import { join } from 'node:path';
import { pathExists } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ParsedManifest, MergeResult } from '../types.js';
import { parsePackageJson, serializePackageJson } from '../parse/npm.js';
import { mergeNpm } from '../merge-impl.js';
import { regenerateLockfile as sharedRegenerateLockfile } from '../lockfile.js';
import type { Ecosystem, ManifestParser } from '../plugin.js';
import { registerParser } from '../plugin.js';
import type { LockfileResult } from '../types.js';

export const npmParser: ManifestParser = {
  ecosystem: 'npm' as Ecosystem,
  async detect(repoPath: string): Promise<boolean> {
    try {
      const exists = await pathExists(join(repoPath, 'package.json'));
      return exists;
    } catch {
      return false;
    }
  },
  parse(content: string, filePath: string): Result<ParsedManifest, StitchError> {
    return parsePackageJson(content, filePath);
  },
  serialize(manifest: ParsedManifest): string {
    if (manifest.ecosystem !== 'npm') {
      throw new Error(`npm parser cannot serialize ${manifest.ecosystem} manifest`);
    }
    return serializePackageJson(manifest.manifest);
  },
  merge(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
    const filtered = manifests.filter(
      (m): m is Extract<ParsedManifest, { ecosystem: 'npm' }> => m.ecosystem === 'npm'
    );
    if (filtered.length === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'manifests',
        message: 'npm parser merge requires at least one npm manifest',
      });
    }
    const narrowed = filtered.map(m => ({ manifest: m.manifest, path: m.path }));
    const result = mergeNpm(narrowed);
    // mergeNpm returns {merged, conflicts, warnings} directly, wrap as ok
    return ok({ merged: result.merged, conflicts: result.conflicts, warnings: result.warnings });
  },
  async regenerateLockfile(
    manifest: ParsedManifest,
    repoPath: string
  ): Promise<Result<LockfileResult, StitchError>> {
    if (manifest.ecosystem !== 'npm') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ecosystem',
        message: `npm parser cannot regenerate lockfile for ${manifest.ecosystem}`,
      });
    }
    // Delegate to shared lockfile logic using the inner manifest
    const unified = manifest.manifest as unknown as import('../types.js').UnifiedManifest;
    return sharedRegenerateLockfile(unified, repoPath);
  },
};

registerParser(npmParser);

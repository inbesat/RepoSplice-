// Go parser plugin (P-115) — wraps P-107.
import { join } from 'node:path';
import { pathExists } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ParsedManifest, MergeResult } from '../types.js';
import { parseGoMod, serializeGoMod } from '../parse/go.js';
import { mergeGo } from '../merge-impl.js';
import { regenerateLockfile as sharedRegenerateLockfile } from '../lockfile.js';
import type { Ecosystem, ManifestParser } from '../plugin.js';
import { registerParser } from '../plugin.js';
import type { LockfileResult } from '../types.js';

export const goParser: ManifestParser = {
  ecosystem: 'go' as Ecosystem,
  async detect(repoPath: string): Promise<boolean> {
    try {
      return await pathExists(join(repoPath, 'go.mod'));
    } catch {
      return false;
    }
  },
  parse(content: string, filePath: string): Result<ParsedManifest, StitchError> {
    return parseGoMod(content, filePath);
  },
  serialize(manifest: ParsedManifest): string {
    if (manifest.ecosystem !== 'go') {
      throw new Error(`go parser cannot serialize ${manifest.ecosystem} manifest`);
    }
    return serializeGoMod(manifest.manifest);
  },
  merge(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
    const filtered = manifests.filter(
      (m): m is Extract<ParsedManifest, { ecosystem: 'go' }> => m.ecosystem === 'go'
    );
    if (filtered.length === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'manifests',
        message: 'go parser merge requires at least one go manifest',
      });
    }
    const narrowed = filtered.map(m => ({ manifest: m.manifest, path: m.path }));
    const result = mergeGo(narrowed);
    return ok({ merged: result.merged, conflicts: result.conflicts, warnings: result.warnings });
  },
  async regenerateLockfile(
    manifest: ParsedManifest,
    repoPath: string
  ): Promise<Result<LockfileResult, StitchError>> {
    if (manifest.ecosystem !== 'go') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ecosystem',
        message: `go parser cannot regenerate lockfile for ${manifest.ecosystem}`,
      });
    }
    const unified = manifest.manifest as unknown as import('../types.js').UnifiedManifest;
    return sharedRegenerateLockfile(unified, repoPath);
  },
};

registerParser(goParser);

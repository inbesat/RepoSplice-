// Cargo parser plugin (P-115) — wraps P-106.
import { join } from 'node:path';
import { pathExists } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../../result/index.js';
import type { ParsedManifest, MergeResult } from '../types.js';
import { parseCargoToml } from '../parse/cargo.js';
import { mergeCargo } from '../merge-impl.js';
import { regenerateLockfile as sharedRegenerateLockfile } from '../lockfile.js';
import type { Ecosystem, ManifestParser } from '../plugin.js';
import { registerParser } from '../plugin.js';
import type { LockfileResult } from '../types.js';

export const cargoParser: ManifestParser = {
  ecosystem: 'cargo' as Ecosystem,
  async detect(repoPath: string): Promise<boolean> {
    try {
      return await pathExists(join(repoPath, 'Cargo.toml'));
    } catch {
      return false;
    }
  },
  parse(content: string, filePath: string): Result<ParsedManifest, StitchError> {
    return parseCargoToml(content, filePath);
  },
  serialize(manifest: ParsedManifest): string {
    if (manifest.ecosystem !== 'cargo') {
      throw new Error(`cargo parser cannot serialize ${manifest.ecosystem} manifest`);
    }
    // Simple JSON serialize for now; actual TOML serialize will be added later
    return JSON.stringify(manifest.manifest, null, 2);
  },
  merge(manifests: ParsedManifest[]): Result<MergeResult, StitchError> {
    const filtered = manifests.filter(
      (m): m is Extract<ParsedManifest, { ecosystem: 'cargo' }> => m.ecosystem === 'cargo'
    );
    if (filtered.length === 0) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'manifests',
        message: 'cargo parser merge requires at least one cargo manifest',
      });
    }
    const narrowed = filtered.map(m => ({ manifest: m.manifest, path: m.path }));
    const result = mergeCargo(narrowed);
    return ok({ merged: result.merged, conflicts: result.conflicts, warnings: result.warnings });
  },
  async regenerateLockfile(
    manifest: ParsedManifest,
    repoPath: string
  ): Promise<Result<LockfileResult, StitchError>> {
    if (manifest.ecosystem !== 'cargo') {
      return err({
        code: 'CONFIG_ERROR',
        field: 'ecosystem',
        message: `cargo parser cannot regenerate lockfile for ${manifest.ecosystem}`,
      });
    }
    const unified = manifest.manifest as unknown as import('../types.js').UnifiedManifest;
    return sharedRegenerateLockfile(unified, repoPath);
  },
};

registerParser(cargoParser);

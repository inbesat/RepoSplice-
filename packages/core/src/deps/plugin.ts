// Ecosystem plugin interface for deps pipeline (P-115).
//
// All four ecosystems (npm, python, cargo, go) share a parallel shape:
// detect → parse → serialize → merge → regenerateLockfile. This module
// codifies that shape as a formal `ManifestParser` plugin interface and
// provides a global in-memory registry so new ecosystems can be added
// with a single `registerParser` call, without editing `merge.ts` or
// `lockfile.ts`.
//
// Safety contract (P-011):
// - No throws except `getParser` on unknown ecosystem (spec mandates
//   throw `UNSUPPORTED_ECOSYSTEM`). All other APIs return Result or
//   boolean/promise, never throw.
// - All parse/merge operations delegate to existing P-104–P-107 modules,
//   which already return Result and handle validation.

import type { Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { LockfileResult } from './types.js';
import type { ParsedManifest, MergeResult } from './types.js';

export type Ecosystem = 'npm' | 'python' | 'cargo' | 'go';

export interface ManifestParser {
  ecosystem: Ecosystem;
  detect(repoPath: string): Promise<boolean>;
  parse(content: string, filePath: string): Result<ParsedManifest, StitchError>;
  serialize(manifest: ParsedManifest): string;
  merge(manifests: ParsedManifest[]): Result<MergeResult, StitchError>;
  regenerateLockfile(
    manifest: ParsedManifest,
    repoPath: string
  ): Promise<Result<LockfileResult, StitchError>>;
}

const registry = new Map<Ecosystem, ManifestParser>();

export function registerParser(parser: ManifestParser): void {
  registry.set(parser.ecosystem, parser);
}

export function getParser(ecosystem: string): ManifestParser {
  const parser = registry.get(ecosystem as Ecosystem);
  if (parser === undefined) {
    const error = new Error(`unsupported ecosystem: ${ecosystem}`) as Error & {
      code: string;
      ecosystem: string;
    };
    error.code = 'UNSUPPORTED_ECOSYSTEM';
    error.ecosystem = ecosystem;
    throw error;
  }
  return parser;
}

export function getAllParsers(): readonly ManifestParser[] {
  return [...registry.values()];
}

export function clearParsersForTests(): void {
  registry.clear();
}

export async function detectEcosystem(repoPath: string): Promise<Ecosystem | null> {
  if (typeof repoPath !== 'string' || repoPath.trim().length === 0) return null;
  const order: Ecosystem[] = ['npm', 'python', 'cargo', 'go'];
  for (const eco of order) {
    const parser = registry.get(eco);
    if (parser === undefined) continue;
    try {
      const found = await parser.detect(repoPath);
      if (found) return eco;
    } catch {
      continue;
    }
  }
  return null;
}

// Re-export shared lockfile types for convenience
export type { LockfileResult } from './types.js';

// NOTICE/Attribution file generation (P-126).
//
// Generates a NOTICE file listing every source dependency with its declared
// license and copyright line, sourced from the P-118 scan + P-181 provenance.
// Triggered by LicensePolicy.requireAttribution.

import { join } from 'node:path';
import { outputFile } from 'fs-extra';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { DeclaredLicense } from './scan.js';
import type { NoticeEntry, NoticeResult } from './types.js';

export type { NoticeEntry, NoticeResult } from './types.js';

function buildNoticeText(entries: NoticeEntry[]): string {
  const header = 'This product includes software developed by the contributors below.\n\n';

  // Group by license (SPDX id)
  const byLicense = new Map<string, NoticeEntry[]>();
  for (const entry of entries) {
    const existing = byLicense.get(entry.license) ?? [];
    existing.push(entry);
    byLicense.set(entry.license, existing);
  }

  // Sort licenses alphabetically for determinism
  const sortedLicenses = [...byLicense.keys()].sort();

  const sections: string[] = [];
  for (const lic of sortedLicenses) {
    const licEntries = byLicense.get(lic) ?? [];
    // Sort entries by package name
    licEntries.sort((a, b) => {
      if (a.package < b.package) return -1;
      if (a.package > b.package) return 1;
      return 0;
    });

    const lines = licEntries.map(e => {
      const parts = [e.package, e.version, e.license];
      if (e.copyright) parts.push(e.copyright);
      if (e.sourceRepo) parts.push(e.sourceRepo);
      return parts.join(' | ');
    });
    sections.push(`
### ${lic}

${lines.join('\n')}
`);
  }

  return header + sections.join('');
}

/** P-126 step 2: sort by package name, drop duplicates by `package@version`. */
function normalizeEntries(entries: NoticeEntry[]): NoticeEntry[] {
  const seen = new Set<string>();
  const unique: NoticeEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.package}@${entry.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  unique.sort((a, b) => {
    if (a.package !== b.package) return a.package < b.package ? -1 : 1;
    if (a.version !== b.version) return a.version < b.version ? -1 : 1;
    return 0;
  });
  return unique;
}

/**
 * Generate a NOTICE file from the given entries.
 *
 * @param entries - Source dependencies with declared license/copyright
 * @param repoPath - Root path where NOTICE should be written
 * @returns Result with NoticeResult metadata or StitchError
 */
export async function generateNotice(
  entries: NoticeEntry[],
  repoPath: string
): Promise<Result<NoticeResult, StitchError>> {
  if (repoPath.trim().length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'repoPath must be a non-empty string',
    });
  }

  // Empty NOTICE is valid — just write the header.
  const normalized = normalizeEntries(entries);

  const noticePath = join(repoPath, 'NOTICE');
  const text = buildNoticeText(normalized);

  try {
    await outputFile(noticePath, text, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err({
      code: 'INTERNAL',
      message: `Failed to write NOTICE file to ${noticePath}: ${message}`,
    });
  }

  return ok({
    path: noticePath,
    entries: normalized,
  });
}

/**
 * Build NoticeEntry[] from DeclaredLicense[] (for wire-in from generate.ts).
 * Uses rawLicenses and preserves copyright from package.json if available.
 */
export function buildNoticeEntries(declared: DeclaredLicense[]): NoticeEntry[] {
  const seen = new Set<string>();
  const entries: NoticeEntry[] = [];

  for (const d of declared) {
    const key = `${d.package}@${d.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({
      package: d.package,
      version: d.version,
      license: d.licenses,
      ...(d.licenseFile ? { copyright: `LICENSE file: ${d.licenseFile}` } : {}),
      ...(d.repository !== undefined ? { sourceRepo: d.repository } : {}),
    });
  }

  // Sort by package name for determinism
  entries.sort((a, b) => {
    if (a.package < b.package) return -1;
    if (a.package > b.package) return 1;
    return 0;
  });

  return entries;
}

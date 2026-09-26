// License file generation for child repo C (P-125).
//
// Renders the official license text for supported SPDX ids (MIT, Apache-2.0,
// BSD-3-Clause, GPL-3.0, MPL-2.0) with correct copyright lines derived from
// provenance authors and the current year. Falls back to a generic header for
// unsupported ids. Writes LICENSE to repo root and adds license field to
// package.json when missing (npm only).
//
// P-126: When policy.requireAttribution is true, also generates NOTICE file.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { outputFile, readFile, pathExists } from 'fs-extra';
import { createHash } from 'node:crypto';
import { err, ok, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import type { GeneratedLicense, NoticeEntry } from './types.js';
import { generateNotice, buildNoticeEntries } from './notice.js';

export type { GeneratedLicense } from './types.js';

const require = createRequire(import.meta.url);

// License template map (SPDX id -> template file basename without extension)
const LICENSE_TEMPLATES: Record<string, string> = {
  MIT: 'mit',
  'Apache-2.0': 'apache-2.0',
  'BSD-3-Clause': 'bsd-3-clause',
  'GPL-3.0': 'gpl-3.0',
  'GPL-3.0-only': 'gpl-3.0',
  'GPL-3.0-or-later': 'gpl-3.0',
  'MPL-2.0': 'mpl-2.0',
};

// Expected header prefixes for each supported license (for verification)
const LICENSE_HEADERS: Record<string, string> = {
  MIT: 'MIT License',
  'Apache-2.0': 'Apache License',
  'BSD-3-Clause': 'BSD 3-Clause License',
  'GPL-3.0': 'GNU GENERAL PUBLIC LICENSE',
  'MPL-2.0': 'Mozilla Public License Version 2.0',
};

export interface HolderInput {
  name: string;
  year?: number;
}

function currentYear(): string {
  return new Date().getFullYear().toString();
}

/** Dedupe by name (case-insensitive) and alphabetize for determinism. */
function dedupeSortHolders(holders: HolderInput[]): HolderInput[] {
  const seen = new Set<string>();
  const unique: HolderInput[] = [];
  for (const h of holders) {
    const key = h.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(h);
    }
  }
  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
}

/**
 * P-125 step 3: year is the current year, or the max author year when the
 * provenance list carries one. Holder years are authoritative — a 2023 commit
 * must not be relabelled as the current year.
 */
function resolveCopyrightYear(holders: HolderInput[]): string {
  const provided = holders
    .map(h => h.year)
    .filter((y): y is number => y !== undefined && Number.isFinite(y));
  return (provided.length > 0 ? Math.max(...provided) : Number(currentYear())).toString();
}

function buildHolderLines(holders: HolderInput[]): { lines: string[]; year: string } {
  const unique = dedupeSortHolders(holders);
  const year = resolveCopyrightYear(unique);
  return { lines: unique.map(h => `Copyright (c) ${year} ${h.name}`), year };
}

function getTemplatePath(templateName: string): string {
  return require.resolve(`./licenses/${templateName}.txt`);
}

function readTemplate(templateName: string): string {
  const templatePath = getTemplatePath(templateName);
  return require('fs').readFileSync(templatePath, 'utf-8');
}

/**
 * Substitute the template placeholders.
 * `<HOLDERS>` expands to the full `Copyright (c) <year> <name>` lines
 * (newline-separated) so a template never has to repeat the prefix.
 */
function renderLicense(template: string, holderLines: string[], year: string): string {
  return template.replace(/<HOLDERS>/g, holderLines.join('\n')).replace(/<YEAR>/g, year);
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Generate a LICENSE file for the given SPDX license id.
 *
 * @param licenseId - SPDX license identifier (e.g., 'MIT', 'Apache-2.0')
 * @param holders - Array of copyright holders with optional year
 * @param repoPath - Root path of the repo where LICENSE should be written
 * @returns Result with GeneratedLicense metadata or StitchError
 */
export async function generateLicense(
  licenseId: string,
  holders: HolderInput[],
  repoPath: string
): Promise<Result<GeneratedLicense, StitchError>> {
  if (licenseId.trim().length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'licenseId',
      message: 'licenseId must be a non-empty string',
    });
  }

  if (repoPath.trim().length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'repoPath must be a non-empty string',
    });
  }

  if (holders.length === 0) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'holders',
      message: 'holders array must not be empty',
    });
  }

  let template: string;
  let isSupported = true;

  const templateKey = LICENSE_TEMPLATES[licenseId];
  if (templateKey !== undefined) {
    try {
      template = readTemplate(templateKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err({
        code: 'INTERNAL',
        message: `Failed to read license template for ${licenseId}: ${message}`,
      });
    }
  } else {
    // Fallback for unsupported licenses
    isSupported = false;
    template = `${licenseId} License

<HOLDERS>

SEE LICENSE in https://spdx.org/licenses/${licenseId}.html
`;
  }

  const { lines: holderLines, year } = buildHolderLines(holders);
  const rendered = renderLicense(template, holderLines, year);

  const licensePath = join(repoPath, 'LICENSE');

  try {
    await outputFile(licensePath, rendered, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err({
      code: 'INTERNAL',
      message: `Failed to write LICENSE file to ${licensePath}: ${message}`,
    });
  }

  // Verify the written file
  let written: string;
  try {
    written = await readFile(licensePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err({
      code: 'INTERNAL',
      message: `Failed to verify LICENSE file at ${licensePath}: ${message}`,
    });
  }

  // Check header matches expected (for supported licenses)
  if (isSupported) {
    const expectedHeader = LICENSE_HEADERS[licenseId];
    if (expectedHeader && !written.trimStart().startsWith(expectedHeader)) {
      return err({
        code: 'INTERNAL',
        message: `Written LICENSE file does not start with expected header "${expectedHeader}" for ${licenseId}`,
      });
    }
  }

  const checksum = sha256(written);

  // Try to add license field to package.json if npm repo and field is missing
  // This is best-effort; failure doesn't affect the primary LICENSE generation
  const pkgPath = join(repoPath, 'package.json');
  if (await pathExists(pkgPath)) {
    try {
      const pkgContent = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      if (!pkg.license || pkg.license.length === 0) {
        pkg.license = licenseId;
        await outputFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      }
    } catch {
      // Ignore package.json errors - not critical for license generation
    }
  }

  return ok({
    licenseId,
    path: licensePath,
    year,
    holderLines,
    checksumSha256: checksum,
  });
}

/**
 * Generate LICENSE + NOTICE (when requireAttribution=true) in one call.
 * Wire-in for P-126: called by orchestration after policy evaluation.
 *
 * @param licenseId - Target SPDX license id (from policy.targetLicense)
 * @param holders - Copyright holders from provenance (P-181)
 * @param repoPath - Root path of child repo C
 * @param policy - LicensePolicy (for requireAttribution flag)
 * @param declared - Declared licenses from scan (for NOTICE entries)
 * @returns Result with GeneratedLicense and optional NoticeResult
 */
export interface GenerateResult {
  license: GeneratedLicense;
  notice?: { path: string; entries: NoticeEntry[] };
}

export async function generateLicenseWithNotice(
  licenseId: string,
  holders: HolderInput[],
  repoPath: string,
  policy: { requireAttribution: boolean; targetLicense: string },
  declared: Array<{
    package: string;
    version: string;
    licenses: string;
    licenseFile?: string;
    repository?: string;
  }>
): Promise<Result<GenerateResult, StitchError>> {
  // First generate LICENSE
  const licenseResult = await generateLicense(licenseId, holders, repoPath);
  if (licenseResult.isErr()) {
    return err(licenseResult.error);
  }

  const license = licenseResult.value;

  // If requireAttribution is true, generate NOTICE
  if (policy.requireAttribution) {
    const noticeEntries = buildNoticeEntries(
      declared.map(d => ({
        package: d.package,
        version: d.version,
        licenses: d.licenses,
        ...(d.licenseFile !== undefined ? { licenseFile: d.licenseFile } : {}),
        ...(d.repository !== undefined ? { repository: d.repository } : {}),
      }))
    );
    const noticeResult = await generateNotice(noticeEntries, repoPath);
    if (noticeResult.isErr()) {
      return err(noticeResult.error);
    }
    return ok({
      license,
      notice: { path: noticeResult.value.path, entries: noticeResult.value.entries },
    });
  }

  return ok({ license });
}

/**
 * Normalize license ID to canonical form for template lookup.
 * E.g., 'GPL-3.0-only' -> 'GPL-3.0', 'GPL-3.0-or-later' -> 'GPL-3.0'
 */
export function normalizeLicenseIdForTemplate(licenseId: string): string {
  // Map common variants to template keys
  if (licenseId.startsWith('GPL-3.0')) return 'GPL-3.0';
  if (licenseId.startsWith('GPL-2.0')) return 'GPL-2.0'; // Not in templates but could be added
  if (licenseId.startsWith('LGPL-')) return licenseId; // Not in templates
  if (licenseId.startsWith('AGPL-')) return licenseId; // Not in templates
  return licenseId;
}

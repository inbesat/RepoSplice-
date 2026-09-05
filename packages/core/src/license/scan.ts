// Thin Result-returning wrapper around `license-checker` (P-023).
//
// `scanDeclared(depsDir)` walks `depsDir/node_modules/**/package.json`,
// returns a `Result<DeclaredLicense[]>` (per the P-011 contract) of
// `{ package, version, licenses, licenseFile?, repository? }` entries.
// The `licenses` field is left as a raw string here; SPDX normalization
// is the job of P-024 (`spdx-expression-parse`).
//
// `license-checker` v25 has no upstream types; we type its subset inline.
//
// Used by P-118 (node_modules scan), P-119 (SPDX normalization),
// P-128 (license report), and the `config.licensePolicy.allow|warn|deny`
// evaluation in P-009.

import { err, ok, type Result } from 'neverthrow';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fromInternalPromise, type StitchError } from '../result/index.js';

// license-checker is JS only (no .d.ts). Use createRequire so we can
// import the CJS module from ESM. We type the subset we use.
const require = createRequire(import.meta.url);
const licenseChecker: LicenseCheckerModule = require('license-checker');

interface LicenseCheckerModule {
  init(
    options: {
      start: string;
      production?: boolean;
      development?: boolean;
      direct?: boolean;
      onlyAllow?: string;
      failOn?: string;
    },
    callback: (err: Error | null | undefined, data?: Record<string, LicenseCheckerEntry>) => void
  ): void;
}

interface LicenseCheckerEntry {
  licenses?: string | string[];
  licenseFile?: string;
  repository?: string;
  publisher?: string;
  url?: string;
  email?: string;
  private?: boolean;
}

export interface DeclaredLicense {
  /** Package name (from the package.json `name` field). */
  package: string;
  /** Resolved semver (from the package.json `version` field). */
  version: string;
  /**
   * Raw `license` field as written in the manifest. May be:
   *   - a single SPDX string ('MIT')
   *   - a semicolon-separated list ('MIT OR Apache-2.0')
   *   - the literal 'UNKNOWN' (license-checker sentinel)
   *   - the literal 'UNLICENSED'
   * SPDX parsing + normalization happens in P-024/P-119.
   */
  licenses: string;
  /** Absolute path to the LICENSE file, if one was found. */
  licenseFile?: string;
  /** Resolved repository URL (from `repository.url` or `repository`). */
  repository?: string;
}

export interface ScanDeclaredOptions {
  /** If true, only scan direct (top-level) dependencies. Default: false. */
  direct?: boolean;
  /** If true, only production deps. Default: false (include dev). */
  production?: boolean;
  /** If true, only dev deps. Default: false. */
  development?: boolean;
}

/**
 * Scan `depsDir` (a directory containing a `node_modules/`) and return
 * the declared license for every installed package.
 *
 * Returns ok(entries) on success, or err(INTERNAL) if license-checker
 * fails (bad path, malformed `package.json`, etc.).
 */
export async function scanDeclared(
  depsDir: string,
  options: ScanDeclaredOptions = {}
): Promise<Result<DeclaredLicense[], StitchError>> {
  // license-checker uses a Node-style callback; promisify via
  // fromInternalPromise by wrapping in a manual Promise.
  const promise = new Promise<Record<string, LicenseCheckerEntry>>((resolveP, rejectP) => {
    licenseChecker.init(
      {
        start: depsDir,
        ...(options.direct !== undefined ? { direct: options.direct } : {}),
        ...(options.production !== undefined ? { production: options.production } : {}),
        ...(options.development !== undefined ? { development: options.development } : {}),
      },
      (err, data) => {
        if (err) {
          rejectP(err);
          return;
        }
        resolveP(data ?? {});
      }
    );
  });
  const dataResult = await fromInternalPromise(promise, 'license-checker.init');
  if (dataResult.isErr()) {
    const detail =
      dataResult.error.code === 'INTERNAL' ? dataResult.error.message : dataResult.error.code;
    return err<DeclaredLicense[], StitchError>({
      code: 'INTERNAL',
      message: `license-checker failed for ${depsDir}: ${detail}`,
    });
  }
  const entries: DeclaredLicense[] = [];
  for (const [key, value] of Object.entries(dataResult.value)) {
    const atIdx = key.lastIndexOf('@');
    if (atIdx <= 0) continue; // skip the root or malformed keys
    const pkg = key.slice(0, atIdx);
    const version = key.slice(atIdx + 1);
    if (value.private) continue; // skip private packages (AGENTS §1)
    const licenses = Array.isArray(value.licenses)
      ? value.licenses.join(' OR ')
      : (value.licenses ?? 'UNKNOWN');
    const entry: DeclaredLicense = { package: pkg, version, licenses };
    if (value.licenseFile) entry.licenseFile = value.licenseFile;
    if (value.repository) entry.repository = value.repository;
    entries.push(entry);
  }
  return ok(entries);
}

/**
 * Convenience: write a tiny `node_modules/<pkg>/package.json` fixture
 * under `root` so license-checker has something to scan. Exposed for
 * tests; production code shouldn't need this (real node_modules exist).
 *
 * @internal — used by the smoke test; not part of the public surface.
 */
export async function writeFixturePkg(
  root: string,
  pkg: string,
  version: string,
  license: string
): Promise<string> {
  const dir = join(root, 'node_modules', pkg);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: pkg, version, license }, null, 2)
  );
  return dir;
}

// Re-export the rm helper for test cleanup symmetry.
export { rm };

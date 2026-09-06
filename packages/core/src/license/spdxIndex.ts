// Offline SPDX license registry wrapper (P-026).
//
// `spdx-license-list@6` ships a 727-entry JSON map of id → { name, url,
// osiApproved, fsfLibre? } — the canonical reference source for the
// pipeline: validating P-025 corrected ids, the P-120 compatibility
// matrix, NOTICE generation (P-126), and the SBOM (P-183). Offline data
// keeps licensing usable in privacy/offline mode (P-301).
//
// `lookupLicense(id)` is the strict-typed entry point: returns the
// metadata for any known SPDX id, or err(UNKNOWN_LICENSE) for ids not
// in the registry. `isKnown(id)` is a boolean convenience for the
// common validation check.
//
// `spdx-license-list@6` is CJS-only and ships a 118 KB `spdx.json`.
// We import the same data via `createRequire` and type the field shape
// inline (no upstream .d.ts, no @types/).

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const spdxList: SpdxListData = require('spdx-license-list/index.js');

interface SpdxEntry {
  name?: string;
  url?: string;
  osiApproved?: boolean;
  fsfLibre?: boolean;
  deprecated?: boolean;
}

type SpdxListData = Record<string, SpdxEntry>;

/**
 * Normalized license metadata exposed to the pipeline.
 *
 * `fsfLibre` is marked optional because `spdx-license-list@6.12.0` does
 * NOT include the field in its shipped data (verified empirically); we
 * keep the field in the shape so consumers (P-126 NOTICE, P-120 matrix)
 * can rely on it once upstream adds it.
 */
export interface LicenseInfo {
  /** SPDX id, exactly as it appears in the registry. */
  id: string;
  /** Human-readable name (e.g. `MIT License`). */
  name: string;
  /** Canonical reference URL (e.g. `https://opensource.org/license/mit/`). */
  url: string;
  /** Approved by the Open Source Initiative. */
  osiApproved: boolean;
  /** FSF Free/Libre? (optional; absent from `spdx-license-list@6.12.0` data). */
  fsfLibre?: boolean;
}

/**
 * Look up the metadata for an SPDX license id.
 *
 * Returns ok(info) on a registry hit, or err({ code:'UNKNOWN_LICENSE', id })
 * for ids not in the registry (so the caller can route to the P-123
 * unknown-path without a separate `isKnown` check).
 *
 * Empty/whitespace input returns err(UNKNOWN_LICENSE) — the registry
 * does not have a blank entry and we don't want to misreport a hit.
 */
export function lookupLicense(id: string): Result<LicenseInfo, StitchError> {
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    return err<LicenseInfo, StitchError>({
      code: 'UNKNOWN_LICENSE',
      id: '',
    });
  }
  const entry = spdxList[trimmed];
  if (entry === undefined) {
    return err<LicenseInfo, StitchError>({
      code: 'UNKNOWN_LICENSE',
      id: trimmed,
    });
  }
  const info: LicenseInfo = {
    id: trimmed,
    name: entry.name ?? trimmed,
    url: entry.url ?? '',
    osiApproved: entry.osiApproved ?? false,
  };
  if (entry.fsfLibre !== undefined) info.fsfLibre = entry.fsfLibre;
  return ok(info);
}

/**
 * Boolean convenience: is `id` a known SPDX id?
 *
 * Use this for *validation* (e.g. P-128 report rows marking `category`).
 * Use `lookupLicense` when you need the full metadata.
 */
export function isKnown(id: string): boolean {
  return id.trim().length > 0 && spdxList[id.trim()] !== undefined;
}

/**
 * Total number of entries in the bundled registry. Exposed for tests
 * and for the P-119 normalization step that wants a fallback match
 * against the full id set.
 */
export function size(): number {
  return Object.keys(spdxList).length;
}

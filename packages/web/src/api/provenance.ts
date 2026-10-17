// P-222 — Web: provenance CREDITS preview (client contracts).
//
// Serves-side endpoints (P-181 provenance map, P-182 CREDITS, P-183 SBOM)
// do not exist yet — P-192 handler-map is deferred. This module FIXES the
// client contract; the server lane implements the same shapes.
//
// Wire types are local: the web tsconfig rootDir cannot import the core
// barrel (TS6059, ADR-104 precedent).

import { describeFailure } from './repos.js';

/**
 * Simplified per-file attribution, per the P-222 spec.
 * Tolerates core's richer `FileOrigin` (P-181) fields via fallbacks:
 * `commit` ← `sourceCommit`, `author` ← `sourceAuthor`.
 */
export interface OriginRow {
  repo: string;
  commit: string;
  author?: string;
}

/** `GET /api/provenance/map` — path → simplified origin. */
export type ProvenanceMap = Record<string, OriginRow>;

/** One repo group in the generated CREDITS document. */
export interface CreditsGroup {
  label: string;
  files: readonly string[];
}

/** `GET /api/provenance/credits` — the generated markdown plus its groups. */
export interface CreditsDoc {
  text: string;
  groups: readonly CreditsGroup[];
}

/**
 * `GET /api/provenance/map` — attribution per file.
 * `commit` ← `sourceCommit`, `author` ← `sourceAuthor` when the server
 * emits core's full `FileOrigin` shape.
 */
export async function getProvenanceMap(): Promise<ProvenanceMap> {
  const response = await fetch('/api/provenance/map');
  if (!response.ok) throw new Error(await describeFailure(response));
  const raw = (await response.json()) as Record<string, Record<string, unknown>>;
  const map: Record<string, OriginRow> = {};
  for (const path of Object.keys(raw)) {
    const v = raw[path] ?? {};
    const author = v.author ?? v.sourceAuthor;
    map[path] = {
      repo: String(v.repo ?? 'unknown'),
      commit: String(v.commit ?? v.sourceCommit ?? ''),
      ...(author !== undefined && author !== null ? { author: String(author) } : {}),
    };
  }
  return map;
}

/** `GET /api/provenance/credits` — the generated CREDITS markdown + groups. */
export async function getCredits(): Promise<CreditsDoc> {
  const response = await fetch('/api/provenance/credits');
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as CreditsDoc;
}

/**
 * `GET /api/provenance/sbom` — the rendered SBOM document (P-183,
 * CycloneDX JSON). Parsed as a plain object; the SBOM tab pretty-prints it.
 */
export async function getSbom(): Promise<Record<string, unknown>> {
  const response = await fetch('/api/provenance/sbom');
  if (!response.ok) throw new Error(await describeFailure(response));
  return (await response.json()) as Record<string, unknown>;
}

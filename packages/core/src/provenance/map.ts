// P-181 — Provenance: track source repo / commit / author per file.
//
// Every file in the child repo C must be traceable to its origin — which source
// repo (A or B) supplied it, the exact commit it came from, and the human who
// authored it. That is the moral and legal core of stitching: attribution
// (CREDITS, P-182), the SBOM (P-183), re-licensing, and the per-file license
// view all read this one map rather than each re-deriving attribution.
//
// Two substrates ALREADY EXIST and are composed here rather than re-implemented
// (the phase names both, and both were read before use):
//
//   - P-079's `git/blameMap.ts` answers "which commit and author produced these
//     lines?" — `buildBlameMap` runs `ls-files` + `blame --line-porcelain` and
//     resolves each line-block to a source. It is the `sourceCommit` /
//     `sourceAuthor` half.
//   - P-165's `Stitch-Origin` trailer (`agent/gitFacade.ts`, already emitted by
//     `commitStage`) answers "what did the merge record about this change?" —
//     source label, source-relative path, and operation. It is the `repo` /
//     `sourcePath` / `stitchedBy` half.
//
// The phase's own signature (`buildProvenanceMap(ctx, mergedFiles: MergeManifest)`)
// names a type that does not exist anywhere in this repo; ADR-054 replaces it with
// the real `BlameMap` input above. Reconciled rather than invented.
//
// Persistence targets the `provenance` table that migration v1 ALREADY defines
// (`store/schema.ts:84-90`: `id`, `repo`, `commit_sha`, `payload`, `created_at`).
// A second table is deliberately not created: `repo` and `commit_sha` are
// first-class columns and the whole `FileOrigin` rides in `payload`.
//
// PII: `sourceEmail` is stored only when `recordEmail` is enabled. Attribution is
// the purpose; harvesting contributor addresses by default is not.

import { ok, err, type Result } from 'neverthrow';
import { type StitchError } from '../result/index.js';
import { dbAll, dbRun, type DbLike, type SQLiteRow } from '../store/schema.js';
import {
  type BlameMap,
  type BlameSource,
  type FileBlame,
  type LineOrigin,
} from '../git/blameMap.js';
import { type StitchOrigin } from '../agent/gitFacade.js';

/** The payload shape version, so a stored row can be rejected rather than misread. */
export const PROVENANCE_PAYLOAD_VERSION = 1;

/** The value used for `sourceCommit` when nothing could be attributed. */
export const UNKNOWN_COMMIT = '';

/** Which source repo a file came from. `'unknown'` is the honest fallback. */
export type SourceRepoLabel = 'A' | 'B' | 'unknown';

/** How a file came to be in C. */
export type StitchedBy = 'agent' | 'manual';

/**
 * The provenance of one file in C (the phase's `FileOrigin`).
 *
 * Field set is the phase's, verbatim. Two values carry the "we could not tell"
 * case explicitly rather than pretending: `repo: 'unknown'` and
 * `sourceCommit: ''`, and a {@link ProvenanceWarning} is emitted for each.
 */
export interface FileOrigin {
  /** Relative path in C. */
  file: string;
  repo: SourceRepoLabel;
  /** The source's remote URL, when a mapping was supplied. */
  remoteUrl?: string;
  /** The A/B commit this file's content came from; `''` when unattributed. */
  sourceCommit: string;
  /** The path in the source tree (the pre-teleport path). */
  sourcePath: string;
  sourceAuthor?: string;
  /** Present only when `recordEmail` is enabled (PII). */
  sourceEmail?: string;
  /** ISO timestamp of when the map recorded this. */
  copiedAt: string;
  stitchedBy: StitchedBy;
}

/** One file that could not be attributed, and why. */
export interface ProvenanceWarning {
  file: string;
  /** A stable, machine-readable reason. */
  reason: 'no-line-origins' | 'uncommitted' | 'unknown-source';
  message: string;
}

/** Options for {@link buildProvenanceMap}. */
export interface ProvenanceOptions {
  /**
   * The blame sources in A-then-B order. Position 0 is labelled `'A'` and
   * position 1 `'B'`; anything else resolves to `'unknown'`. Each source's
   * `prefix` is the P-070 filter-repo child-tree prefix used to recover the
   * original path.
   */
  sources?: readonly BlameSource[];
  /** P-165 trailers by staged path (the merge's recorded origin). */
  origins?: ReadonlyMap<string, StitchOrigin>;
  /** Fallback lookup for a path not present in `origins`. */
  originFor?: (file: string) => StitchOrigin | undefined;
  /** Remote URL per source label (`'A'`/`'B'`) for `remoteUrl`. */
  remoteUrls?: Readonly<Record<string, string>>;
  /** Optional persistence target (the v1 `provenance` table). */
  db?: DbLike;
  /** Clock, injectable so tests are deterministic. */
  now?: () => string;
  /**
   * Store `sourceEmail`. Default `false` — the PII-safe posture, since the
   * phase's cited `provenance.recordEmail` config key does not exist (ADR-054).
   */
  recordEmail?: boolean;
  /** Receives one warning per unattributable file. */
  onWarning?: (warning: ProvenanceWarning) => void;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Position in the source list decides the label: 0 → A, 1 → B. */
function labelFor(sources: readonly BlameSource[], name: string | null): SourceRepoLabel {
  if (name === null) return 'unknown';
  const index = sources.findIndex(source => source.name === name);
  if (index === 0) return 'A';
  if (index === 1) return 'B';
  return 'unknown';
}

/** The prefix the matched source was teleported under, if any. */
function prefixFor(sources: readonly BlameSource[], name: string | null): string | undefined {
  if (name === null) return undefined;
  const index = sources.findIndex(source => source.name === name);
  const matched = index >= 0 ? sources[index] : undefined;
  return matched?.prefix;
}

/**
 * Recover the original source path by stripping the teleport prefix.
 *
 * P-070's filter-repo mapping rewrites `lib/util.ts` in A to `repo-a/lib/util.ts`
 * in C; the original path is what attribution and CREDITS must show.
 */
function stripPrefix(path: string, prefix: string | undefined): string {
  if (prefix === undefined) return path;
  const trimmed = prefix.replace(/[/\\]+$/, '');
  if (trimmed === '') return path;
  if (path === trimmed) return '';
  if (path.startsWith(`${trimmed}/`)) return path.slice(trimmed.length + 1);
  return path;
}

/**
 * The line-block covering the most lines — the file's dominant origin.
 *
 * Ties break on the earliest `startLine` so the answer is deterministic
 * (P-282): the same tree always yields the same attribution.
 */
function dominantOrigin(file: FileBlame): LineOrigin | undefined {
  let best: LineOrigin | undefined;
  let bestLength = -1;
  for (const origin of file.origins) {
    const length = origin.endLine - origin.startLine + 1;
    if (
      length > bestLength ||
      (length === bestLength && best !== undefined && origin.startLine < best.startLine)
    ) {
      best = origin;
      bestLength = length;
    }
  }
  return best;
}

/** Parse a stored payload back into a `FileOrigin`, or `undefined` if unusable. */
function parseStoredOrigin(row: SQLiteRow): FileOrigin | undefined {
  const payload = row['payload'];
  if (typeof payload !== 'string' || payload === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  const file = record['file'];
  const sourceCommit = record['sourceCommit'];
  const sourcePath = record['sourcePath'];
  const copiedAt = record['copiedAt'];
  const repo = record['repo'];
  const stitchedBy = record['stitchedBy'];
  if (
    typeof file !== 'string' ||
    typeof sourceCommit !== 'string' ||
    typeof sourcePath !== 'string' ||
    typeof copiedAt !== 'string' ||
    (repo !== 'A' && repo !== 'B' && repo !== 'unknown') ||
    (stitchedBy !== 'agent' && stitchedBy !== 'manual')
  ) {
    return undefined;
  }
  const remoteUrl = record['remoteUrl'];
  const sourceAuthor = record['sourceAuthor'];
  const sourceEmail = record['sourceEmail'];
  return {
    file,
    repo,
    ...(typeof remoteUrl === 'string' && remoteUrl !== '' ? { remoteUrl } : {}),
    sourceCommit,
    sourcePath,
    ...(typeof sourceAuthor === 'string' && sourceAuthor !== '' ? { sourceAuthor } : {}),
    ...(typeof sourceEmail === 'string' && sourceEmail !== '' ? { sourceEmail } : {}),
    copiedAt,
    stitchedBy,
  };
}

/**
 * The file → origin map: the single source of attribution everywhere.
 *
 * In-memory for the session, persistable to the v1 `provenance` table, and
 * queried through {@link getOrigin} (the P-185 tooltip / P-124 per-file path).
 */
export class ProvenanceMap {
  readonly #byFile: Map<string, FileOrigin>;
  readonly #warnings: ProvenanceWarning[];
  readonly #checksumManifestPath: string | undefined;

  constructor(
    origins: readonly FileOrigin[],
    warnings: readonly ProvenanceWarning[] = [],
    checksumManifestPath?: string
  ) {
    this.#byFile = new Map();
    for (const origin of origins) this.#byFile.set(origin.file, origin);
    this.#warnings = [...warnings];
    this.#checksumManifestPath = checksumManifestPath;
  }

  /** A map from a list of origins. */
  static from(
    origins: readonly FileOrigin[],
    warnings: readonly ProvenanceWarning[] = [],
    checksumManifestPath?: string
  ): ProvenanceMap {
    return new ProvenanceMap(origins, warnings, checksumManifestPath);
  }

  /**
   * P-186: the checksum manifest written for this map's tree, when known.
   *
   * Optional and additive. It is a SESSION reference to the tamper-evidence
   * anchor, so it is deliberately NOT part of the persisted origins payload.
   */
  get checksumManifestPath(): string | undefined {
    return this.#checksumManifestPath;
  }

  /** Every origin, sorted by file path for a stable export (P-282). */
  origins(): FileOrigin[] {
    return [...this.#byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  }

  /** Look one file up. Accepts either separator convention. */
  getOrigin(file: string): FileOrigin | undefined {
    const direct = this.#byFile.get(file);
    if (direct !== undefined) return direct;
    const normalized = file.replace(/\\/g, '/');
    return this.#byFile.get(normalized);
  }

  /** The unattributable files this build observed. */
  warnings(): ProvenanceWarning[] {
    return [...this.#warnings];
  }

  /** How many files are attributed. */
  get size(): number {
    return this.#byFile.size;
  }

  /**
   * Append every origin to the `provenance` table.
   *
   * One row per file: `repo` and `commit_sha` as columns, the whole `FileOrigin`
   * as JSON. The v1 table has no per-file uniqueness, so rows APPEND — which
   * incidentally keeps an audit trail of how attribution changed between runs;
   * {@link load} reads the newest row per file.
   */
  async save(db: DbLike): Promise<Result<number, StitchError>> {
    let written = 0;
    for (const origin of this.origins()) {
      const payload = JSON.stringify({ v: PROVENANCE_PAYLOAD_VERSION, ...origin });
      const result = dbRun(
        db,
        'INSERT INTO provenance (repo, commit_sha, payload) VALUES (?, ?, ?)',
        origin.repo,
        origin.sourceCommit === '' ? null : origin.sourceCommit,
        payload
      );
      if (result.isErr()) return err(result.error);
      written += 1;
    }
    return ok(written);
  }

  /** Rebuild the map from the table, newest row winning per file. */
  static async load(db: DbLike): Promise<Result<ProvenanceMap, StitchError>> {
    const rows = dbAll(db, 'SELECT id, repo, commit_sha, payload FROM provenance ORDER BY id ASC');
    if (rows.isErr()) return err(rows.error);
    const byFile = new Map<string, FileOrigin>();
    for (const row of rows.value) {
      const origin = parseStoredOrigin(row);
      if (origin !== undefined) byFile.set(origin.file, origin);
    }
    return ok(new ProvenanceMap([...byFile.values()]));
  }
}

/**
 * Derive the provenance map for a staged tree.
 *
 * `blame` is P-079's output for one source repo (or several, when A and B were
 * both merged — pass them all and the origins are combined). Attribution prefers
 * the P-165 trailer for what the merge RECORDED (repo, source path, whether the
 * agent touched it) and P-079's blame for what git can PROVE (commit, author).
 */
export async function buildProvenanceMap(
  blame: BlameMap | readonly BlameMap[],
  opts: ProvenanceOptions = {}
): Promise<Result<ProvenanceMap, StitchError>> {
  const maps = Array.isArray(blame) ? (blame as readonly BlameMap[]) : [blame as BlameMap];
  const sources = opts.sources ?? [];
  const now = opts.now ?? (() => new Date().toISOString());
  const origins: FileOrigin[] = [];
  const warnings: ProvenanceWarning[] = [];

  for (const map of maps) {
    for (const file of map.files) {
      const trailer = opts.origins?.get(file.path) ?? opts.originFor?.(file.path);
      const dominant = dominantOrigin(file);
      const repoFromTrailer =
        trailer !== undefined && (trailer.source === 'A' || trailer.source === 'B')
          ? trailer.source
          : undefined;
      const label: SourceRepoLabel =
        repoFromTrailer ?? labelFor(sources, dominant?.sourceRepo ?? null);

      // The one thing worth warning about: no committed line to attribute.
      if (dominant === undefined) {
        warnings.push({
          file: file.path,
          reason: 'no-line-origins',
          message: `${file.path} has no line origins, so it cannot be attributed`,
        });
      } else if (dominant.sha === null) {
        warnings.push({
          file: file.path,
          reason: 'uncommitted',
          message: `${file.path} is uncommitted (all-zero blame), so it has no source commit`,
        });
      } else if (label === 'unknown') {
        warnings.push({
          file: file.path,
          reason: 'unknown-source',
          message: `${file.path} blames to commit ${dominant.sha} but no source matched it`,
        });
      }

      const unattributed = dominant === undefined || dominant.sha === null || label === 'unknown';
      const sourcePath =
        trailer?.path !== undefined && trailer.path !== ''
          ? trailer.path
          : stripPrefix(file.path, prefixFor(sources, dominant?.sourceRepo ?? null));
      const remoteUrl = opts.remoteUrls?.[label];
      const author = dominant?.author;
      const mail = dominant?.authorMail ?? null;

      origins.push({
        file: file.path,
        repo: unattributed ? 'unknown' : label,
        ...(remoteUrl !== undefined && remoteUrl !== '' ? { remoteUrl } : {}),
        sourceCommit: dominant?.sha ?? UNKNOWN_COMMIT,
        sourcePath,
        ...(author !== undefined && author !== '' ? { sourceAuthor: author } : {}),
        // PII: the address is kept only when the caller opted in.
        ...(opts.recordEmail === true && mail !== null && mail !== '' ? { sourceEmail: mail } : {}),
        copiedAt: now(),
        stitchedBy: trailer?.source === 'agent' || trailer?.op === 'component' ? 'agent' : 'manual',
      });
    }
  }

  for (const warning of warnings) opts.onWarning?.(warning);

  const map = ProvenanceMap.from(origins, warnings);
  if (opts.db === undefined) return ok(map);
  const saved = await map.save(opts.db);
  if (saved.isErr()) return err(saved.error);
  return ok(map);
}

/** Test/consumer helper: describe a warning for a log line. */
export function describeProvenanceWarning(warning: ProvenanceWarning): string {
  return `${warning.reason}: ${detailOf(warning.message)}`;
}

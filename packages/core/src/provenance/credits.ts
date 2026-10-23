// P-182 — Provenance: CREDITS.md.
//
// CREDITS is the HUMAN read of P-181's provenance map (the SBOM, P-183, is the
// machine/legal one). It credits every upstream contributor and source repo,
// grouped by source repo, with a fallback section for files that could not be
// attributed so a reader never has to guess why a file is missing.
//
// Two properties are load-bearing and are why this is a pure renderer plus one
// write:
//
//   DETERMINISTIC. Output is sorted by repo then file path, and the header's
//   timestamp defaults to the LATEST `copiedAt` already in the map rather than
//   the wall clock — so the same map always renders byte-identical text, which
//   is what makes CI checks and the P-222 web preview safe to diff. Pass `now`
//   only when a true generation stamp matters more than stability.
//
//   PII-SAFE BY DEFAULT. `sourceEmail` is rendered only when `includeEmails` is
//   true, and every retained address is SCRUBBED from the text when it is false
//   — a guard rather than a convention, so a future edit to a template cannot
//   leak an address that P-181 deliberately retained behind its own opt-in.
//
// The first three table columns (`| File in C | Source Commit | Author |`) are
// the P-182 contract: the web preview and CI checks parse them, so they keep
// their indices. P-351 APPENDED two more (`Confidence`, `Flags`) behind them —
// an append-only change, so a parser reading the first three cells reads the
// same values it always did.

import { ok, err, type Result } from 'neverthrow';
import { outputFile } from 'fs-extra';
import { type StitchError } from '../result/index.js';
import { type SemanticConfidence } from '../confidence/schema.js';
import { UNKNOWN_COMMIT, type FileOrigin, type ProvenanceMap } from './map.js';

/** The file CREDITS is written to, at the root of child repo C. */
export const CREDITS_FILENAME = 'CREDITS.md';

/** How many characters of a commit SHA the table shows. */
export const SHORT_COMMIT_LENGTH = 7;

/** The cell shown when a file has no attributable commit. */
export const NO_COMMIT_CELL = '—';

/** The section heading for files nothing could be attributed to. */
export const UNATTRIBUTED_HEADING = 'Unattributed';

/** The cell shown when a file has no recorded confidence score. */
export const NO_CONFIDENCE_CELL = 'N/A';

/** The cell shown when a file has no confidence flags. */
export const NO_FLAGS_CELL = '—';

/**
 * The credits table columns, in order: P-182's three, then P-351's two.
 *
 * The header and the separator are both built from this list so the two rows
 * cannot drift apart (a drifted separator renders the whole table as text).
 */
export const CREDITS_COLUMNS = [
  'File in C',
  'Source Commit',
  'Author',
  'Confidence',
  'Flags',
] as const;

/** Options for {@link generateCredits}. */
export interface CreditsOptions {
  /** Display name for source repo A (defaults to `A`). */
  repoNameA?: string;
  /** Display name for source repo B (defaults to `B`). */
  repoNameB?: string;
  /** Include contributor email addresses. Default `false`. */
  includeEmails?: boolean;
  /** Replaces the generated title block entirely when supplied. */
  header?: string;
  /**
   * The confidence score per file in C, keyed by the C path (`origin.file`).
   *
   * P-351: when a file has an entry, its `composite_score` fills the Confidence
   * column and its `flags` fill the Flags column; a file with no entry renders
   * 'N/A' and a note under `## Notes` says why. Absent entirely is the legacy
   * case — every file renders 'N/A'.
   */
  confidence?: Readonly<Record<string, SemanticConfidence>>;
  /**
   * Where to write `<repoC>/CREDITS.md`. When absent the document is only
   * returned — which is the pure path tests and the P-222 preview use.
   */
  repoC?: string;
  /**
   * Override the header timestamp. Defaults to the latest `copiedAt` in the map,
   * which keeps the output stable for a given map (see the module header).
   */
  now?: () => string;
}

/** One rendered group: a repo label, optionally split by remote URL. */
interface RepoGroup {
  label: 'A' | 'B' | 'unknown';
  remoteUrl?: string;
  origins: FileOrigin[];
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `abcdef1234...` → `abcdef1`, and `''` → the no-commit cell. */
function shortCommit(sha: string): string {
  if (sha === UNKNOWN_COMMIT || sha.trim() === '') return NO_COMMIT_CELL;
  return sha.slice(0, SHORT_COMMIT_LENGTH);
}

/** The display name for a repo label. */
function repoTitle(label: 'A' | 'B' | 'unknown', opts: CreditsOptions): string {
  if (label === 'A') return opts.repoNameA ?? 'A';
  if (label === 'B') return opts.repoNameB ?? 'B';
  return UNATTRIBUTED_HEADING;
}

/** The order sections appear in: A, then B, then anything unattributed. */
function repoRank(label: 'A' | 'B' | 'unknown'): number {
  return label === 'A' ? 0 : label === 'B' ? 1 : 2;
}

/** Group origins by repo, then by remote URL, sorted for stable output. */
function groupOrigins(origins: readonly FileOrigin[]): RepoGroup[] {
  const byKey = new Map<string, RepoGroup>();
  for (const origin of origins) {
    const key = `${origin.repo}\u0000${origin.remoteUrl ?? ''}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        label: origin.repo,
        ...(origin.remoteUrl !== undefined ? { remoteUrl: origin.remoteUrl } : {}),
        origins: [origin],
      });
    } else {
      existing.origins.push(origin);
    }
  }
  const groups = [...byKey.values()];
  for (const group of groups) group.origins.sort((a, b) => a.file.localeCompare(b.file));
  groups.sort((a, b) => {
    const rank = repoRank(a.label) - repoRank(b.label);
    if (rank !== 0) return rank;
    return (a.remoteUrl ?? '').localeCompare(b.remoteUrl ?? '');
  });
  return groups;
}

/** The header timestamp: the map's own latest recording, or an override. */
function headerTimestamp(origins: readonly FileOrigin[], opts: CreditsOptions): string {
  if (opts.now !== undefined) return opts.now();
  let latest = '';
  for (const origin of origins) if (origin.copiedAt > latest) latest = origin.copiedAt;
  return latest;
}

/** The header row and the separator, both built from the one column list. */
function tableHeader(): string[] {
  return [
    `| ${CREDITS_COLUMNS.join(' | ')} |`,
    `| ${CREDITS_COLUMNS.map(() => '---').join(' | ')} |`,
  ];
}

/** The Confidence cell: the rounded composite, or the N/A cell when absent. */
function confidenceCell(record: SemanticConfidence | undefined): string {
  const score: unknown = record?.composite_score;
  if (typeof score !== 'number' || !Number.isFinite(score)) return NO_CONFIDENCE_CELL;
  return String(Math.round(score));
}

/** The Flags cell: the warning strings joined by `, `, or the no-flags cell. */
function flagsCell(record: SemanticConfidence | undefined): string {
  const flags: unknown = record?.flags;
  if (!Array.isArray(flags)) return NO_FLAGS_CELL;
  const kept: string[] = [];
  for (const flag of flags) {
    if (typeof flag === 'string' && flag.trim() !== '') kept.push(flag.trim());
  }
  return kept.length === 0 ? NO_FLAGS_CELL : kept.join(', ');
}

function tableFor(
  group: RepoGroup,
  includeEmails: boolean,
  confidence: Readonly<Record<string, SemanticConfidence>> | undefined
): string[] {
  const lines = tableHeader();
  for (const origin of group.origins) {
    // The C path always leads the cell (the fixed, parsed column); the original
    // source path is appended only when it differs, i.e. the teleport case.
    const file =
      origin.sourcePath !== origin.file && origin.sourcePath !== ''
        ? `\`${origin.file}\` (from \`${origin.sourcePath}\`)`
        : `\`${origin.file}\``;
    const author = origin.sourceAuthor ?? '_unknown_';
    const email =
      includeEmails && origin.sourceEmail !== undefined ? ` <${origin.sourceEmail}>` : '';
    const record = confidence?.[origin.file];
    const cells = [
      file,
      shortCommit(origin.sourceCommit),
      `${author}${email}`,
      confidenceCell(record),
      flagsCell(record),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines;
}

/**
 * Render P-181's provenance map as CREDITS.md, optionally writing it out.
 *
 * Returns the rendered content in every case, so a caller can preview (P-185)
 * or serve it (P-222) without reading the file back.
 */
export async function generateCredits(
  map: ProvenanceMap,
  opts: CreditsOptions = {}
): Promise<Result<string, StitchError>> {
  const includeEmails = opts.includeEmails === true;
  const origins = map.origins();
  const groups = groupOrigins(origins);
  const confidence = opts.confidence;
  // A file with no recorded score renders the N/A cell; when any file does, the
  // Notes section says why (spec step 4) so a reader never has to guess.
  const hasUnscored = origins.some(origin => confidence?.[origin.file] === undefined);

  const lines: string[] = [];
  const timestamp = headerTimestamp(origins, opts);
  if (opts.header !== undefined) {
    lines.push(opts.header.trimEnd(), '');
  } else {
    lines.push('# Credits', '');
    if (timestamp !== '') lines.push(`> Generated from provenance recorded at ${timestamp}`, '');
  }

  const attributed = groups.filter(group => group.label !== 'unknown');
  for (const group of attributed) {
    lines.push(`## ${repoTitle(group.label, opts)}`, '');
    if (group.remoteUrl !== undefined && group.remoteUrl !== '') {
      lines.push(`Repository: ${group.remoteUrl}`, '');
    }
    lines.push(...tableFor(group, includeEmails, opts.confidence), '');
  }

  // Unattributed files get their own section rather than being dropped: a
  // reader must be able to see that a file exists and that we could not say
  // where it came from.
  const unattributed = groups.filter(group => group.label === 'unknown');
  for (const group of unattributed) {
    lines.push(`## ${UNATTRIBUTED_HEADING}`, '');
    lines.push(
      'These files could not be traced to a source repository. They are listed so',
      'nothing is silently omitted from attribution.',
      ''
    );
    lines.push(...tableFor(group, includeEmails, opts.confidence), '');
  }

  // Transparency: say plainly which files the agent stitched.
  const agentFiles = origins
    .filter(origin => origin.stitchedBy === 'agent')
    .map(origin => origin.file)
    .sort((a, b) => a.localeCompare(b));
  lines.push('## Notes', '');
  if (agentFiles.length === 0) {
    lines.push('No files were stitched by the agent.', '');
  } else {
    lines.push('The following files were edited or stitched by the agent:', '');
    for (const file of agentFiles) lines.push(`- \`${file}\``);
    lines.push('');
  }

  // Legacy files: say plainly that a blank Confidence cell is "not recorded"
  // rather than "no confidence", so nobody reads N/A as a score of zero.
  if (hasUnscored) {
    lines.push(
      'Files showing N/A in the Confidence column have no recorded confidence score',
      '(they predate the confidence pipeline).',
      ''
    );
  }

  // Warnings P-181 retained (why a file is unattributed), when any were kept.
  const warnings = map.warnings();
  if (warnings.length > 0) {
    lines.push('### Attribution warnings', '');
    for (const warning of warnings) {
      lines.push(`- \`${warning.file}\`: ${warning.reason}`);
    }
    lines.push('');
  }

  let text = lines.join('\n');

  // PII guard: an address that P-181 retained behind its own opt-in must never
  // reach a document the caller did not ask to include emails in.
  if (!includeEmails) {
    for (const origin of origins) {
      const email = origin.sourceEmail;
      if (email !== undefined && email !== '') text = text.split(email).join('[redacted]');
    }
  }

  if (opts.repoC === undefined) return ok(text);
  if (opts.repoC.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoC',
      message: 'generateCredits: repoC must not be blank when provided',
    });
  }

  const target = `${opts.repoC.replace(/[/\\]+$/, '')}/${CREDITS_FILENAME}`;
  try {
    await outputFile(target, text);
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `generateCredits: cannot write ${target}: ${detailOf(cause)}`,
    });
  }
  return ok(text);
}

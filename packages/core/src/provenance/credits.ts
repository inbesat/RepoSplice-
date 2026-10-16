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
// The table columns (`| File in C | Source Commit | Author |`) are fixed: the
// handoff states the web preview and CI checks parse them.

import { ok, err, type Result } from 'neverthrow';
import { outputFile } from 'fs-extra';
import { type StitchError } from '../result/index.js';
import { UNKNOWN_COMMIT, type FileOrigin, type ProvenanceMap } from './map.js';

/** The file CREDITS is written to, at the root of child repo C. */
export const CREDITS_FILENAME = 'CREDITS.md';

/** How many characters of a commit SHA the table shows. */
export const SHORT_COMMIT_LENGTH = 7;

/** The cell shown when a file has no attributable commit. */
export const NO_COMMIT_CELL = '—';

/** The section heading for files nothing could be attributed to. */
export const UNATTRIBUTED_HEADING = 'Unattributed';

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

function tableFor(group: RepoGroup, includeEmails: boolean): string[] {
  const lines = ['| File in C | Source Commit | Author |', '| --- | --- | --- |'];
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
    lines.push(`| ${file} | ${shortCommit(origin.sourceCommit)} | ${author}${email} |`);
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
    lines.push(...tableFor(group, includeEmails), '');
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
    lines.push(...tableFor(group, includeEmails), '');
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

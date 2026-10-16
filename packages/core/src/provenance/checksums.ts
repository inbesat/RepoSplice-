// P-186 — Provenance: the checksum manifest.
//
// The tamper-evidence anchor. To prove later that the composed repo C is exactly
// what was stitched — for integrity, tamper detection and release auditing — every
// staged file's SHA-256 at completion is recorded, together with a hash over the
// whole manifest so the manifest itself cannot be edited quietly.
//
// Four properties are deliberate:
//
//   1. THE MANIFEST HASH EXCLUDES `generatedAt`. `manifestSha256` covers
//      `{ algorithm, entries }` only. Including the timestamp would make the hash
//      change on every run for an identical tree, which is precisely the property
//      a stability check exists to prove.
//   2. THE WRITTEN FILE IS `sha256sum`-SHAPED (`<hash>  <path>`, two spaces) and
//      sorted, so stock coreutils can verify it. A bespoke format would make the
//      anchor unverifiable by the tools an auditor already has.
//   3. FILES ARE HASHED AS BYTES, STREAMED. The stream is never decoded to utf8:
//      `git/binary.ts` records that checksums "still carry every byte", so a
//      binary file must hash identically however it is opened. Streaming also
//      bounds memory by the chunk size rather than the repository size.
//   4. A MISSING FILE IS A MISMATCH, NOT AN ERROR. `verifyChecksums` answers
//      `valid: false` for drift AND for absence — both mean "C is not what was
//      recorded", which is the question the caller asked.

import { err, ok, type Result } from 'neverthrow';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { outputFile } from 'fs-extra';
import pLimit from 'p-limit';
import { type StitchError } from '../result/index.js';
import { listFiles } from '../util/glob.js';
import { toPosix } from '../util/paths.js';

/** The file the manifest is written to, at the root of child repo C. */
export const CHECKSUM_MANIFEST_FILENAME = 'checksums.sha256';

/** The only algorithm this phase records. */
export const CHECKSUM_ALGORITHM = 'sha256';

/** Default concurrent hashes. Bounded so a huge tree cannot exhaust handles. */
export const DEFAULT_HASH_CONCURRENCY = 8;

/**
 * Paths never worth checksumming: version control, installed dependencies and
 * build output. They are GENERATED, so their bytes do not describe the stitch —
 * and `node_modules` alone would dominate both the time and the manifest.
 */
export const DEFAULT_CHECKSUM_IGNORES: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/.cache/**',
  CHECKSUM_MANIFEST_FILENAME,
];

/** One hashed file. */
export interface ChecksumEntry {
  /** Path relative to the repo root, posix-normalised. */
  path: string;
  sha256: string;
  sizeBytes: number;
}

/** The manifest, in the phase's shape. */
export interface ChecksumManifest {
  generatedAt: string;
  algorithm: 'sha256';
  /** Sorted by path, so the document is stable (P-282). */
  entries: ChecksumEntry[];
  /** SHA-256 over `{ algorithm, entries }` — see the module header, point 1. */
  manifestSha256: string;
}

/** What verification reports. */
export interface ChecksumVerification {
  valid: boolean;
  /** Paths that drifted or are missing, sorted. */
  mismatches: string[];
}

/** Options for {@link buildChecksumManifest}. */
export interface BuildChecksumOptions {
  /** Extra glob patterns to skip, merged with {@link DEFAULT_CHECKSUM_IGNORES}. */
  ignore?: readonly string[];
  /** Where to write `checksums.sha256`. Absent ⇒ render only, no write. */
  repoC?: string;
  /** Bounded concurrency. Default {@link DEFAULT_HASH_CONCURRENCY}. */
  concurrency?: number;
  /** Clock, injectable so a test can pin the stamp. */
  now?: () => string;
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Hash one file as a byte stream. */
async function hashFile(
  absolutePath: string
): Promise<Result<{ sha256: string; sizeBytes: number }, StitchError>> {
  const hash = createHash(CHECKSUM_ALGORITHM);
  let sizeBytes = 0;
  try {
    // Byte stream, never decoded — a binary file hashes as its bytes.
    for await (const chunk of createReadStream(absolutePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      hash.update(buffer);
      sizeBytes += buffer.length;
    }
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `buildChecksumManifest: cannot hash ${absolutePath}: ${detailOf(cause)}`,
    });
  }
  return ok({ sha256: hash.digest('hex'), sizeBytes });
}

/** The hash over the stable part of the manifest. */
function computeManifestSha(entries: readonly ChecksumEntry[]): string {
  // `generatedAt` is deliberately excluded (module header, point 1).
  return createHash(CHECKSUM_ALGORITHM)
    .update(JSON.stringify({ algorithm: CHECKSUM_ALGORITHM, entries }), 'utf8')
    .digest('hex');
}

/** Render the manifest as sorted `sha256sum` lines. */
export function renderChecksumFile(entries: readonly ChecksumEntry[]): string {
  // `<hash>  <path>` — two spaces, exactly what `sha256sum -c` accepts.
  return entries.map(entry => `${entry.sha256}  ${entry.path}`).join('\n') + '\n';
}

/**
 * Walk the staged tree and record a SHA-256 per file.
 *
 * Ignore globs are applied during the walk, so an excluded tree costs nothing to
 * traverse beyond the directory entry itself.
 */
export async function buildChecksumManifest(
  repoPath: string,
  opts: BuildChecksumOptions = {}
): Promise<Result<ChecksumManifest, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'buildChecksumManifest: repoPath is required',
    });
  }

  const ignore = [...DEFAULT_CHECKSUM_IGNORES, ...(opts.ignore ?? [])];
  const walked = await listFiles(repoPath, ['**/*'], { ignore, dot: true });
  if (walked.isErr()) return err(walked.error);

  const limit = pLimit(Math.max(1, opts.concurrency ?? DEFAULT_HASH_CONCURRENCY));
  const hashed = await Promise.all(
    walked.value.map(absolute =>
      limit(async (): Promise<Result<ChecksumEntry, StitchError>> => {
        const digested = await hashFile(absolute);
        if (digested.isErr()) return err(digested.error);
        return ok({
          path: toPosix(relative(repoPath, absolute)),
          sha256: digested.value.sha256,
          sizeBytes: digested.value.sizeBytes,
        });
      })
    )
  );
  const entries: ChecksumEntry[] = [];
  for (const entry of hashed) {
    if (entry.isErr()) return err(entry.error);
    entries.push(entry.value);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const manifest: ChecksumManifest = {
    generatedAt: (opts.now ?? (() => new Date().toISOString()))(),
    algorithm: CHECKSUM_ALGORITHM,
    entries,
    manifestSha256: computeManifestSha(entries),
  };

  if (opts.repoC === undefined) return ok(manifest);
  if (opts.repoC.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoC',
      message: 'buildChecksumManifest: repoC must not be blank when provided',
    });
  }
  const target = `${opts.repoC.replace(/[/\\]+$/, '')}/${CHECKSUM_MANIFEST_FILENAME}`;
  try {
    await outputFile(target, renderChecksumFile(entries));
  } catch (cause: unknown) {
    return err({
      code: 'INTERNAL',
      message: `buildChecksumManifest: cannot write ${target}: ${detailOf(cause)}`,
    });
  }
  return ok(manifest);
}

/**
 * Re-hash the tree and report anything that no longer matches.
 *
 * Drift, a missing file and a changed size all mean the same thing to a caller —
 * "C is not what was recorded" — so they all land in `mismatches` with
 * `valid: false`. A MISSING entry is reported rather than thrown, because absence
 * is one of the answers this function exists to give.
 */
export async function verifyChecksums(
  repoPath: string,
  manifest: ChecksumManifest,
  opts: Pick<BuildChecksumOptions, 'concurrency'> = {}
): Promise<Result<ChecksumVerification, StitchError>> {
  if (repoPath.trim() === '') {
    return err({
      code: 'CONFIG_ERROR',
      field: 'repoPath',
      message: 'verifyChecksums: repoPath is required',
    });
  }

  const limit = pLimit(Math.max(1, opts.concurrency ?? DEFAULT_HASH_CONCURRENCY));
  const checked = await Promise.all(
    manifest.entries.map(entry =>
      limit(async (): Promise<Result<string | undefined, StitchError>> => {
        const absolute = `${repoPath.replace(/[/\\]+$/, '')}/${entry.path}`;
        const exists = await stat(absolute).then(
          () => true,
          () => false
        );
        // Absent ⇒ a mismatch, not an error.
        if (!exists) return ok(entry.path);
        const digested = await hashFile(absolute);
        if (digested.isErr()) return err(digested.error);
        return ok(
          digested.value.sha256 === entry.sha256 && digested.value.sizeBytes === entry.sizeBytes
            ? undefined
            : entry.path
        );
      })
    )
  );

  const mismatches: string[] = [];
  for (const result of checked) {
    if (result.isErr()) return err(result.error);
    if (result.value !== undefined) mismatches.push(result.value);
  }
  mismatches.sort((a, b) => a.localeCompare(b));
  return ok({ valid: mismatches.length === 0, mismatches });
}

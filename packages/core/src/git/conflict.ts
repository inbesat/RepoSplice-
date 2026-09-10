// Git conflict detection + resolution (P-075): make a merged tree buildable
// by resolving unmerged index entries. Flow: detect (porcelain + diff-U,
// stage SHAs, NUL-binary sniff) -> classify -> auto tiers (whitespace,
// gitignore union, one-side-unchanged, injected manifest delegate) ->
// approval gate for the ambiguous rest (never auto-written) -> apply
// (checkout/add or staged write) -> re-verify empty (P-084's future home).
//
// Verified behavior (real git 2.47 on this box — do not assume otherwise):
// - Unmerged porcelain codes are exactly DD AU UD UA DU AA UU; `diff
//   --diff-filter=U` lists the same paths. UU carries stages 1/2/3, AA
//   stages 2/3 (no base), UD/DU carry two (the deleted side is absent),
//   DD carries stage 1 only.
// - `diff --numstat` on an unmerged path is USELESS (prints 0/0 + staged
//   markers, never `- -`). Binary is decided the way git decides it: a NUL
//   byte in the first 8000 bytes of any present stage blob ("Binary files
//   differ" appears exactly for those; high bytes alone stay text).
// - `diff --quiet --ignore-all-space <blob2> <blob3>`: exit 0 = equivalent
//   (covers trailing-newline-only), 1 = different, 128 = bad object.
//   Plain `diff` (no --quiet/--exit-code) always exits 0, so the quiet flag
//   is load-bearing. Blob-vs-blob needs NO --no-index (that flag forces
//   path interpretation and fails on SHAs).
// - `checkout --ours/--theirs -- <path>` + `add -- <path>` resolves a UU;
//   on a deleted-side shape (UD) --ours fails ("does not have our
//   version"), so deleted shapes are gate-only.
// - The runner returns exit codes as DATA (never rejects): exit 1 from
//   --quiet means "different", not failure. This answers the P-074
//   simple-git raw lesson (silent failures conflated with absence) —
//   absence of output with exit 0 is a real signal here, and every other
//   exit maps explicitly.
//
// Safety contract:
// - The runner always gets an explicit cwd (P-070 rule); validation runs
//   before any spawn (blank path / bad timeout never spawns).
// - Union/manifest/gate writes go through resolveTargetPath: traversal,
//   absolute, and any `.git` segment refuse with CONFIG_ERROR (P-265).
// - Ambiguous hunks are NEVER written without an explicit gate approval;
//   with no gate wired they are reported gated + untouched.
// - Every runner rejection maps to INTERNAL; every nonzero exit maps to a
//   typed GIT_ERROR (124 = timeout sentinel); no new StitchError codes
//   (P-203 owns future taxonomy).
//
// Seams and future phases:
// - ConflictRuntime.run is the only process seam (execFile default);
//   writeFile is injectable so the destructive arm is scriptable.
// - ManifestMerge is the narrow port the P-108/109/110/113 deps merge will
//   implement; until then manifests defer to the gate. ConflictGate is the
//   narrow port the P-160 HilQueue (+ P-218 UI) will implement; until then
//   ambiguous conflicts wait. P-082 owns canonical binary classification
//   (check-attr + ext config); the NUL sniff here is git's own rule.
// - Name note for P-108: `Conflict` here is the git index conflict. The
//   future `deps/types.ts` Conflict (manifest value collisions) must alias
//   on re-export (e.g. `DepsConflict`) to avoid a root-barrel collision.

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { ok, err, type Result } from 'neverthrow';
import type { StitchError } from '../result/index.js';
import { logger, createJobLogger } from '../logger/index.js';
import { resolveWithin } from '../util/paths.js';

/** Silence timeout (ms): local git plumbing is fast; 60s is generous. */
export const DEFAULT_CONFLICT_TIMEOUT_MS = 60_000;

/** Exec timeout sentinel: Node kills the child (SIGTERM/ETIMEDOUT). */
const TIMEOUT_EXIT_CODE = 124;

/** First-N-bytes window git itself uses for binary detection. */
const BINARY_SNIFF_BYTES = 8000;

/** Porcelain XY codes that mark an unmerged index entry (git status docs). */
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Deleted-side porcelain: a side is absent by construction. */
const DELETED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU']);

/** Dependency manifests routed to the P-108/109 delegate (P-108 ecosystems). */
const MANIFEST_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'requirements.txt',
  'pyproject.toml',
  // Canonical capitalizations (Cargo.toml, not cargo.toml).
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
]);

export type ConflictKind = 'text' | 'binary' | 'manifest' | 'gitignore' | 'deleted';

export type ConflictRecommendation = 'take-ours' | 'take-theirs' | 'union' | 'manual';

/** Stage blob SHAs from `ls-files -u` (absent = side deleted/never added). */
export interface ConflictStages {
  base?: string;
  ours?: string;
  theirs?: string;
}

export interface Conflict {
  path: string;
  kind: ConflictKind;
  recommendation: ConflictRecommendation;
  stages: ConflictStages;
  porcelain: string;
}

/** Proposal handed to the approval gate (P-160/P-218 shape). */
export interface ConflictProposal {
  path: string;
  kind: ConflictKind;
  recommendation: ConflictRecommendation;
  stages: ConflictStages;
  reason: string;
  /** Stage text for text kinds; omitted for binary bytes (SHAs only). */
  oursContent?: string;
  theirsContent?: string;
}

export type GateDecision =
  | { decision: 'approved'; action: 'take-ours' | 'take-theirs' | 'write'; content?: string }
  | { decision: 'rejected'; reason: string }
  | { decision: 'pending'; note?: string };

/** Narrow port the P-160 HilQueue will implement. */
export interface ConflictGate {
  requestApproval(proposal: ConflictProposal): Promise<Result<GateDecision, StitchError>>;
}

/** Narrow port the P-108/109 deps merge will implement. */
export interface ManifestMerge {
  /**
   * Resolve a conflicted manifest to full file content, or null when it
   * cannot be auto-resolved (defers to the gate). Errors pass through
   * unchanged — they are the delegate's own typed failures.
   */
  resolveManifest(
    repoPath: string,
    path: string,
    stages: ConflictStages
  ): Promise<Result<string | null, StitchError>>;
}

export interface ConflictOpts {
  /** Absent: ambiguous conflicts are reported gated, never written. */
  gate?: ConflictGate;
  /** Absent: manifests defer to the gate (P-108/109 pending). */
  manifestMerge?: ManifestMerge;
  /** Silence timeout ms for git processes. Default: 60_000. */
  timeoutMs?: number;
  /** Job id for structured logs. */
  jobId?: string;
}

/** Process result as data: exit codes are signals, never rejections. */
export interface ConflictRunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

export interface ConflictRunner {
  (args: readonly string[], cwd: string, opts: { timeoutMs: number }): Promise<ConflictRunResult>;
}

export interface ConflictRuntime {
  run?: ConflictRunner;
  writeFile?: (path: string, content: string) => Promise<void>;
}

export type ResolutionStrategy =
  'take-ours' | 'take-theirs' | 'whitespace' | 'gitignore-union' | 'manifest' | 'gate-approved';

export interface ResolvedConflict {
  path: string;
  strategy: ResolutionStrategy;
}

export interface GatedConflict {
  path: string;
  reason: string;
}

export interface ResolveReport {
  resolved: ResolvedConflict[];
  gated: GatedConflict[];
  /** Still unmerged after everything (expected for gated paths). */
  unresolved: string[];
}

const execFileAsync = promisify(execFile);

/** Default runner: real git via PATH, killed after timeoutMs of silence. */
async function defaultRun(
  args: readonly string[],
  cwd: string,
  opts: { timeoutMs: number }
): Promise<ConflictRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', [...args], {
      cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'buffer',
    });
    return { exitCode: 0, stdout: stdout as Buffer, stderr: String(stderr) };
  } catch (error) {
    return { exitCode: exitCodeOf(error), stdout: Buffer.from(''), stderr: detailOf(error) };
  }
}

/**
 * Map a spawn rejection to a process exit code. Exported for unit tests:
 * the timeout sentinel (124) is load-bearing (checkRun/runFailure branch
 * on it) and must stay pinned without flaky timing tests.
 */
export function exitCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null) {
    const rec = error as { code?: unknown; killed?: unknown; status?: unknown };
    if (rec.killed === true || rec.code === 'ETIMEDOUT') return TIMEOUT_EXIT_CODE;
    if (typeof rec.code === 'number') return rec.code;
    if (typeof rec.status === 'number') return rec.status;
  }
  return 1;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function causeDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Narrow GIT_ERROR factory (P-071 lesson: never widen to StitchError). */
function gitFailure(
  op: string,
  cause: unknown
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  const detail = causeDetail(cause);
  return { code: 'GIT_ERROR', message: `${op} failed: ${detail}`, gitOutput: detail };
}

function invalid(field: string, message: string): Result<never, StitchError> {
  return err({ code: 'CONFIG_ERROR', field, message });
}

function internalError(op: string, cause: unknown): StitchError {
  return {
    code: 'INTERNAL',
    message: `${op}: ${causeDetail(cause)}`,
    ...(cause instanceof Error ? { cause } : {}),
  };
}

interface NormalizedOpts {
  repoPath: string;
  timeoutMs: number;
  jobId: string | undefined;
  gate: ConflictGate | undefined;
  manifestMerge: ManifestMerge | undefined;
}

/** Validate everything before any spawn (no process on misuse). */
function normalizeOpts(repoPath: string, opts: ConflictOpts): Result<NormalizedOpts, StitchError> {
  if (repoPath.trim() === '') {
    return invalid('repoPath', 'conflict: repoPath is required');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CONFLICT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return invalid('timeoutMs', 'conflict: timeoutMs must be an integer >= 1');
  }
  return ok({
    repoPath,
    timeoutMs,
    jobId: opts.jobId,
    gate: opts.gate,
    manifestMerge: opts.manifestMerge,
  });
}

interface BoundRuntime {
  run: ConflictRunner;
  writeFile: (path: string, content: string) => Promise<void>;
}

function bindRuntime(runtime: ConflictRuntime | undefined): BoundRuntime {
  return {
    run: runtime?.run ?? defaultRun,
    writeFile: runtime?.writeFile ?? writeFile,
  };
}

/**
 * Map a finished process to its stdout Buffer. Exit 124 is the timeout
 * sentinel; every other nonzero exit is a GIT_ERROR with git's stderr.
 */
function runFailure(
  op: string,
  result: ConflictRunResult,
  timeoutMs: number
): { code: 'GIT_ERROR'; message: string; gitOutput: string } {
  if (result.exitCode === TIMEOUT_EXIT_CODE) {
    return gitFailure(op, `timed out after ${timeoutMs}ms`);
  }
  const detail =
    result.stderr.trim() === '' ? `exit code ${result.exitCode}` : result.stderr.trim();
  return gitFailure(op, detail);
}

function checkRun(
  op: string,
  result: ConflictRunResult,
  timeoutMs: number
): Result<Buffer, StitchError> {
  if (result.exitCode === 0) return ok(result.stdout);
  return err(runFailure(op, result, timeoutMs));
}

/** Run git, converting runner rejections (spawn failures) to INTERNAL. */
async function runGit(
  bound: BoundRuntime,
  op: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  let result: ConflictRunResult;
  try {
    result = await bound.run(args, cwd, { timeoutMs });
  } catch (error) {
    return err(internalError(op, error));
  }
  return checkRun(op, result, timeoutMs);
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Pure classifier: stage SHAs + binary sniff -> kind + recommendation.
 * One side unchanged from base is provably safe to auto-take (the other
 * side is the only change); everything else textual goes to the
 * whitespace probe or the gate. Porcelain deleted codes force the deleted
 * kind even if the stages ever look complete (they cannot, by git's
 * construction — belt and braces).
 */
export function classifyStages(
  path: string,
  porcelain: string,
  stages: ConflictStages,
  isBinary: boolean
): { kind: ConflictKind; recommendation: ConflictRecommendation } {
  if (DELETED_CODES.has(porcelain) || stages.ours === undefined || stages.theirs === undefined) {
    return { kind: 'deleted', recommendation: 'manual' };
  }
  if (isBinary) return { kind: 'binary', recommendation: 'manual' };
  const base = basenameOf(path);
  if (MANIFEST_BASENAMES.has(base)) return { kind: 'manifest', recommendation: 'manual' };
  if (base === '.gitignore') return { kind: 'gitignore', recommendation: 'union' };
  if (stages.base !== undefined && stages.base === stages.ours) {
    return { kind: 'text', recommendation: 'take-theirs' };
  }
  if (stages.base !== undefined && stages.base === stages.theirs) {
    return { kind: 'text', recommendation: 'take-ours' };
  }
  return { kind: 'text', recommendation: 'manual' };
}

/**
 * Union two .gitignore sides: ours lines first, theirs-unique appended,
 * exact-line dedupe, CRLF normalized, exactly one trailing newline.
 * Negations and anchors survive untouched (line-based, no parsing).
 */
export function unionGitignoreSides(ours: string, theirs: string): string {
  const linesOf = (text: string): string[] => {
    const stripped = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
    return stripped === '' ? [] : stripped.split('\n');
  };
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of [...linesOf(ours), ...linesOf(theirs)]) {
    if (!seen.has(line)) {
      seen.add(line);
      merged.push(line);
    }
  }
  return `${merged.join('\n')}\n`;
}

/**
 * Resolve a conflict-relative path to an absolute write target. Refuses
 * traversal, platform-absolute escapes (via resolveWithin, P-012) and any
 * `.git` segment (P-265) — case-insensitively, for Windows/macOS FS.
 */
export function resolveTargetPath(repoPath: string, rel: string): Result<string, StitchError> {
  const within = resolveWithin(repoPath, rel);
  if (within.isErr()) return err(within.error);
  const segments = within.value.split('/');
  if (segments.some(segment => segment.toLowerCase() === '.git')) {
    return err({
      code: 'CONFIG_ERROR',
      field: 'path',
      message: `conflict: refusing to write into .git ("${rel}")`,
    });
  }
  return ok(within.value);
}

/** Git's own binary rule: NUL in the first 8000 bytes. */
function hasNulByte(blob: Buffer): boolean {
  const window = blob.subarray(0, Math.min(blob.length, BINARY_SNIFF_BYTES));
  return window.includes(0);
}

function splitNul(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .map(part => part.trim())
    .filter(part => part !== '');
}

interface DetectedState {
  conflicts: Conflict[];
  /** Stage blob bytes by SHA (read once for sniffing, reused for unions). */
  blobs: Map<string, Buffer>;
}

/** Parse `status --porcelain=v1 -z` into path -> XY. */
function parsePorcelain(output: Buffer): Result<Map<string, string>, StitchError> {
  const codes = new Map<string, string>();
  for (const entry of splitNul(output)) {
    if (entry.length < 4 || entry[2] !== ' ') {
      return err(
        internalError('conflict: parse porcelain', `malformed entry ${JSON.stringify(entry)}`)
      );
    }
    codes.set(entry.slice(3), entry.slice(0, 2));
  }
  return ok(codes);
}

const LS_FILES_RE = /^([0-9]+) ([0-9a-f]{40}) ([123])\t([\s\S]*)$/;

/** Parse `ls-files -u -z` into path -> stage SHAs. */
function parseLsFiles(output: Buffer): Result<Map<string, ConflictStages>, StitchError> {
  const stages = new Map<string, ConflictStages>();
  for (const entry of splitNul(output)) {
    const match = LS_FILES_RE.exec(entry);
    if (match?.[2] === undefined || match[3] === undefined || match[4] === undefined) {
      return err(
        internalError('conflict: parse ls-files', `malformed entry ${JSON.stringify(entry)}`)
      );
    }
    const sha = match[2];
    const path = match[4];
    const current = stages.get(path) ?? {};
    if (match[3] === '1') current.base = sha;
    else if (match[3] === '2') current.ours = sha;
    else current.theirs = sha;
    stages.set(path, current);
  }
  return ok(stages);
}

async function readBlob(
  bound: BoundRuntime,
  repoPath: string,
  sha: string,
  timeoutMs: number
): Promise<Result<Buffer, StitchError>> {
  return runGit(bound, 'conflict read blob', ['show', sha], repoPath, timeoutMs);
}

/** Full detection pipeline: unmerged set -> stages -> sniff -> classify. */
async function detectInto(
  bound: BoundRuntime,
  normalized: NormalizedOpts
): Promise<Result<DetectedState, StitchError>> {
  const { repoPath, timeoutMs } = normalized;
  const gitDir = await runGit(
    bound,
    'conflict rev-parse',
    ['rev-parse', '--git-dir'],
    repoPath,
    timeoutMs
  );
  if (gitDir.isErr()) {
    const message = gitDir.error.code === 'GIT_ERROR' ? gitDir.error.message : '';
    if (/not a git repository/i.test(message)) {
      return err({
        code: 'CONFIG_ERROR',
        field: 'repoPath',
        message: `conflict: not a git repository ("${repoPath}")`,
      });
    }
    return err(gitDir.error);
  }
  const porcelainOut = await runGit(
    bound,
    'conflict status',
    ['status', '--porcelain=v1', '-z'],
    repoPath,
    timeoutMs
  );
  if (porcelainOut.isErr()) return err(porcelainOut.error);
  const codes = parsePorcelain(porcelainOut.value);
  if (codes.isErr()) return err(codes.error);
  const diffOut = await runGit(
    bound,
    'conflict diff',
    ['diff', '--name-only', '-z', '--diff-filter=U', '--'],
    repoPath,
    timeoutMs
  );
  if (diffOut.isErr()) return err(diffOut.error);
  const paths = new Set<string>();
  for (const [path, xy] of codes.value) {
    if (UNMERGED_CODES.has(xy)) paths.add(path);
  }
  for (const path of splitNul(diffOut.value)) paths.add(path);
  if (paths.size === 0) return ok({ conflicts: [], blobs: new Map() });

  const lsOut = await runGit(
    bound,
    'conflict ls-files',
    ['ls-files', '-u', '-z'],
    repoPath,
    timeoutMs
  );
  if (lsOut.isErr()) return err(lsOut.error);
  const stagesByPath = parseLsFiles(lsOut.value);
  if (stagesByPath.isErr()) return err(stagesByPath.error);

  const conflicts: Conflict[] = [];
  const blobs = new Map<string, Buffer>();
  const ordered = [...paths].sort();
  for (const path of ordered) {
    const stages = stagesByPath.value.get(path);
    if (stages === undefined) {
      return err(internalError('conflict: detect', `no index stages for unmerged path "${path}"`));
    }
    const shas = [stages.base, stages.ours, stages.theirs].filter(
      (sha): sha is string => sha !== undefined
    );
    let isBinary = false;
    for (const sha of shas) {
      let blob = blobs.get(sha);
      if (blob === undefined) {
        const read = await readBlob(bound, repoPath, sha, timeoutMs);
        if (read.isErr()) return err(read.error);
        blob = read.value;
        blobs.set(sha, blob);
      }
      if (hasNulByte(blob)) {
        isBinary = true;
        break;
      }
    }
    const porcelain = codes.value.get(path) ?? '??';
    const { kind, recommendation } = classifyStages(path, porcelain, stages, isBinary);
    conflicts.push({ path, kind, recommendation, stages, porcelain });
  }
  return ok({ conflicts, blobs });
}

/**
 * Detect unmerged index entries with classification (text/ours/theirs
 * recommendation, binary, manifest, gitignore, deleted per P-082).
 */
export async function detectConflicts(
  repoPath: string,
  opts: ConflictOpts = {},
  runtime?: ConflictRuntime
): Promise<Result<Conflict[], StitchError>> {
  const normalized = normalizeOpts(repoPath, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const detected = await detectInto(bound, normalized.value);
  if (detected.isErr()) return err(detected.error);
  return ok(detected.value.conflicts);
}

/** `diff --quiet -w`: exit 0 = whitespace-equivalent, 1 = different. */
async function isWhitespaceEquivalent(
  bound: BoundRuntime,
  repoPath: string,
  ours: string,
  theirs: string,
  timeoutMs: number
): Promise<Result<boolean, StitchError>> {
  let result: ConflictRunResult;
  try {
    result = await bound.run(['diff', '--quiet', '--ignore-all-space', ours, theirs], repoPath, {
      timeoutMs,
    });
  } catch (error) {
    return err(internalError('conflict whitespace probe', error));
  }
  if (result.exitCode === 0) return ok(true);
  if (result.exitCode === 1) return ok(false);
  return err(runFailure('conflict whitespace probe', result, timeoutMs));
}

async function applyCheckout(
  bound: BoundRuntime,
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs',
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const picked = await runGit(
    bound,
    `conflict checkout --${side}`,
    ['checkout', `--${side}`, '--', path],
    repoPath,
    timeoutMs
  );
  if (picked.isErr()) return err(picked.error);
  const staged = await runGit(bound, 'conflict add', ['add', '--', path], repoPath, timeoutMs);
  if (staged.isErr()) return err(staged.error);
  return ok(undefined);
}

async function applyWrite(
  bound: BoundRuntime,
  repoPath: string,
  path: string,
  content: string,
  timeoutMs: number
): Promise<Result<void, StitchError>> {
  const target = resolveTargetPath(repoPath, path);
  if (target.isErr()) return err(target.error);
  try {
    await bound.writeFile(target.value, content);
  } catch (error) {
    return err(internalError('conflict write resolution', error));
  }
  const staged = await runGit(bound, 'conflict add', ['add', '--', path], repoPath, timeoutMs);
  if (staged.isErr()) return err(staged.error);
  return ok(undefined);
}

function textSide(blobs: Map<string, Buffer>, sha: string | undefined): string | undefined {
  if (sha === undefined) return undefined;
  const blob = blobs.get(sha);
  if (blob === undefined || hasNulByte(blob)) return undefined;
  return blob.toString('utf8');
}

function reasonFor(conflict: Conflict, suffix = ''): string {
  switch (conflict.kind) {
    case 'binary':
      return `binary file changed on both sides — byte choice needs a human${suffix}`;
    case 'deleted':
      return `deleted on one side, modified on the other — intent needs a human${suffix}`;
    case 'manifest':
      return `dependency manifest — deferred to the deps merge (P-108/P-109)${suffix}`;
    case 'gitignore':
      // Unreachable today (gitignore conflicts always carry both sides and
      // routeAuto handles them); kept so the switch stays total over kinds.
      return `gitignore union failed${suffix}`;
    case 'text':
      return `both sides changed "${conflict.path}" with incompatible edits${suffix}`;
  }
}

interface RouteOutcome {
  resolved?: ResolvedConflict;
  gated?: GatedConflict;
}

/** Auto tiers that never need approval: side-unchanged, whitespace, union, delegate. */
async function routeAuto(
  bound: BoundRuntime,
  normalized: NormalizedOpts,
  conflict: Conflict,
  blobs: Map<string, Buffer>
): Promise<Result<RouteOutcome | null, StitchError>> {
  const { repoPath, timeoutMs, manifestMerge } = normalized;
  const { stages } = conflict;
  if (conflict.recommendation === 'take-ours' || conflict.recommendation === 'take-theirs') {
    const side = conflict.recommendation === 'take-ours' ? 'ours' : 'theirs';
    const applied = await applyCheckout(bound, repoPath, conflict.path, side, timeoutMs);
    if (applied.isErr()) return err(applied.error);
    return ok({ resolved: { path: conflict.path, strategy: conflict.recommendation } });
  }
  if (conflict.kind === 'gitignore' && stages.ours !== undefined && stages.theirs !== undefined) {
    const oursText = textSide(blobs, stages.ours) ?? '';
    const theirsText = textSide(blobs, stages.theirs) ?? '';
    const applied = await applyWrite(
      bound,
      repoPath,
      conflict.path,
      unionGitignoreSides(oursText, theirsText),
      timeoutMs
    );
    if (applied.isErr()) return err(applied.error);
    return ok({ resolved: { path: conflict.path, strategy: 'gitignore-union' } });
  }
  if (conflict.kind === 'manifest' && manifestMerge !== undefined) {
    let merged: Result<string | null, StitchError>;
    try {
      merged = await manifestMerge.resolveManifest(repoPath, conflict.path, stages);
    } catch (error) {
      return err(internalError('conflict manifest delegate', error));
    }
    if (merged.isErr()) return err(merged.error);
    if (merged.value !== null) {
      const applied = await applyWrite(bound, repoPath, conflict.path, merged.value, timeoutMs);
      if (applied.isErr()) return err(applied.error);
      return ok({ resolved: { path: conflict.path, strategy: 'manifest' } });
    }
    return ok(null);
  }
  if (conflict.kind === 'text' && stages.ours !== undefined && stages.theirs !== undefined) {
    const equivalent = await isWhitespaceEquivalent(
      bound,
      repoPath,
      stages.ours,
      stages.theirs,
      timeoutMs
    );
    if (equivalent.isErr()) return err(equivalent.error);
    if (equivalent.value) {
      const applied = await applyCheckout(bound, repoPath, conflict.path, 'ours', timeoutMs);
      if (applied.isErr()) return err(applied.error);
      return ok({ resolved: { path: conflict.path, strategy: 'whitespace' } });
    }
  }
  return ok(null);
}

/** Gate path: propose, await approval, apply or record. Never auto-writes. */
async function routeGate(
  bound: BoundRuntime,
  normalized: NormalizedOpts,
  conflict: Conflict,
  blobs: Map<string, Buffer>
): Promise<Result<RouteOutcome, StitchError>> {
  const { repoPath, timeoutMs, gate } = normalized;
  const proposal: ConflictProposal = {
    path: conflict.path,
    kind: conflict.kind,
    recommendation: conflict.recommendation,
    stages: conflict.stages,
    reason: reasonFor(conflict),
    ...(textSide(blobs, conflict.stages.ours) !== undefined
      ? { oursContent: textSide(blobs, conflict.stages.ours) as string }
      : {}),
    ...(textSide(blobs, conflict.stages.theirs) !== undefined
      ? { theirsContent: textSide(blobs, conflict.stages.theirs) as string }
      : {}),
  };
  if (gate === undefined) {
    return ok({
      gated: {
        path: conflict.path,
        reason: `${proposal.reason} (no approval gate wired — left for P-160 HIL)`,
      },
    });
  }
  let decision: Result<GateDecision, StitchError>;
  try {
    decision = await gate.requestApproval(proposal);
  } catch (error) {
    return err(internalError('conflict approval gate', error));
  }
  if (decision.isErr()) return err(decision.error);
  const resolved = decision.value;
  if (resolved.decision === 'rejected') {
    return ok({ gated: { path: conflict.path, reason: `rejected: ${resolved.reason}` } });
  }
  if (resolved.decision === 'pending') {
    return ok({
      gated: { path: conflict.path, reason: `awaiting approval: ${resolved.note ?? 'queued'}` },
    });
  }
  if (resolved.action === 'write') {
    if (resolved.content === undefined) {
      return err(internalError('conflict approval gate', 'gate approved a write without content'));
    }
    const applied = await applyWrite(bound, repoPath, conflict.path, resolved.content, timeoutMs);
    if (applied.isErr()) return err(applied.error);
    return ok({ resolved: { path: conflict.path, strategy: 'gate-approved' } });
  }
  const applied = await applyCheckout(
    bound,
    repoPath,
    conflict.path,
    resolved.action === 'take-ours' ? 'ours' : 'theirs',
    timeoutMs
  );
  if (applied.isErr()) return err(applied.error);
  return ok({ resolved: { path: conflict.path, strategy: 'gate-approved' } });
}

/**
 * Resolve every conflict: auto tiers first, the approval gate for the
 * ambiguous rest, then re-verify (re-run detect). Auto-resolved paths
 * that survive re-verify are INTERNAL — the apply did not stick.
 */
export async function resolveConflicts(
  repoPath: string,
  opts: ConflictOpts = {},
  runtime?: ConflictRuntime
): Promise<Result<ResolveReport, StitchError>> {
  const normalized = normalizeOpts(repoPath, opts);
  if (normalized.isErr()) return err(normalized.error);
  const bound = bindRuntime(runtime);
  const options = normalized.value;
  const log = (options.jobId === undefined ? logger : createJobLogger(options.jobId)).child({
    op: 'conflict',
    repoPath: options.repoPath,
  });
  const detected = await detectInto(bound, options);
  if (detected.isErr()) return err(detected.error);
  log.debug({ conflicts: detected.value.conflicts.length }, 'conflicts detected');

  const report: ResolveReport = { resolved: [], gated: [], unresolved: [] };
  // Every path an apply touched (auto tier or gate-approved): still listed
  // after re-verify means the apply did not stick — INTERNAL.
  const appliedPaths = new Set<string>();
  for (const conflict of detected.value.conflicts) {
    const auto = await routeAuto(bound, options, conflict, detected.value.blobs);
    if (auto.isErr()) return err(auto.error);
    if (auto.value?.resolved !== undefined) {
      report.resolved.push(auto.value.resolved);
      appliedPaths.add(conflict.path);
      continue;
    }
    const gated = await routeGate(bound, options, conflict, detected.value.blobs);
    if (gated.isErr()) return err(gated.error);
    if (gated.value.resolved !== undefined) {
      report.resolved.push(gated.value.resolved);
      appliedPaths.add(conflict.path);
    } else if (gated.value.gated !== undefined) {
      report.gated.push(gated.value.gated);
    }
  }

  const verify = await detectInto(bound, options);
  if (verify.isErr()) return err(verify.error);
  const remaining = new Set(verify.value.conflicts.map(conflict => conflict.path));
  for (const path of appliedPaths) {
    if (remaining.has(path)) {
      return err(internalError('conflict verify', `"${path}" is still conflicted after apply`));
    }
  }
  report.unresolved = [...remaining].sort();
  log.debug({ resolved: report.resolved.length, gated: report.gated.length }, 'conflicts resolved');
  return ok(report);
}
